// 纯业务逻辑层：不依赖 HTTP 框架，便于在 Node 中直接单元测试。
// 数据库访问通过传入的 db 适配器（D1 / MySQL 均实现相同接口：all / first / run）。

import { enc, dec, sha256Hex, validId } from './crypto.js';

export const SLOTS_SEED = [
  ['2026-08-14', '14:00', '16:00'],
  ['2026-08-14', '16:00', '18:00'],
  ['2026-08-15', '10:00', '12:00'],
  ['2026-08-15', '12:00', '14:00'],
  ['2026-08-15', '14:00', '16:00'],
  ['2026-08-15', '16:00', '18:00'],
];

export function makeConfig(env) {
  return {
    ADMIN_PASSWORD: env.ADMIN_PASSWORD || '404112',
    RETENTION_DAYS: parseInt(env.RETENTION_DAYS || '30', 10),
    REQUIRE_ID: (env.REQUIRE_ID || '0') === '1',
    CAPACITY: parseInt(env.CAPACITY || '30', 10),
    PEPPER: env.PEPPER || 'change_me_pepper',
    BASE_URL: env.BASE_URL || '',
    ENCRYPTION_KEY: env.ENCRYPTION_KEY || '',
  };
}

// 首次运行写入时段种子（幂等）
export async function seedIfEmpty(db, capacity) {
  const rows = await db.all('SELECT COUNT(*) AS n FROM slots');
  const n = rows[0] && rows[0].n ? Number(rows[0].n) : 0;
  if (n > 0) return;
  for (const [d, s, e] of SLOTS_SEED) {
    await db.run(
      'INSERT INTO slots(date, start_time, end_time, capacity, available) VALUES(?,?,?,?,?)',
      [d, s, e, capacity, capacity]
    );
  }
}

function keyHash(pepper, key) {
  // 等价 Python：sha256(PEPPER + key.strip().lower())
  return sha256Hex(pepper + key.trim().toLowerCase());
}

function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function fail(code, msg, http) {
  return { ok: false, code, msg, http };
}

function isUniqueError(e) {
  const m = (e && (e.message || e.sqlMessage || '')) || ''.toUpperCase();
  return (
    m.includes('UNIQUE') ||
    m.includes('CONSTRAINT') ||
    m.includes('DUPLICATE') ||
    (e && e.code === 'ER_DUP_ENTRY')
  );
}

// ---------- 预约 ----------
export async function bookingCreate(db, cfg, input) {
  const date = input.date;
  const slot_id = Number(input.slot_id);
  const name = (input.name || '').trim();
  let companions = Array.isArray(input.companions) ? input.companions : [];
  companions = companions.map((c) => String(c).trim()).filter(Boolean);

  if (!name) return fail('NAME_REQUIRED', '请填写姓名', 400);
  if (cfg.REQUIRE_ID && !input.booker_id) return fail('ID_REQUIRED', '请填写身份证号', 400);
  const booker_id = (input.booker_id || '').trim();
  if (booker_id && !validId(booker_id)) return fail('ID_INVALID', '身份证号格式或校验位错误', 400);
  if (companions.length > 2) return fail('TOO_MANY', '随行人最多 2 人', 400);

  const party_size = 1 + companions.length;
  const key = booker_id || name;
  const token = newToken();
  const now = new Date().toISOString().slice(0, 19);
  const kh = await keyHash(cfg.PEPPER, key);

  // 先查重复（避免先扣名额再回滚）
  const dup = await db.first(
    "SELECT id FROM bookings WHERE booker_key_hash=? AND booking_date=? AND status='active'",
    [kh, date]
  );
  if (dup) return fail('DUPLICATE', '您今天已预约过该活动', 409);

  // 原子扣减名额（WHERE available>=N 防止超卖）
  const upd = await db.run(
    'UPDATE slots SET available=available-? WHERE id=? AND available>=?',
    [party_size, slot_id, party_size]
  );
  if (upd.changes === 0) return fail('SOLD_OUT', '该时段名额不足或已约满', 409);

  try {
    const ins = await db.run(
      'INSERT INTO bookings(token, booker_key_hash, booking_date, slot_id, party_size, booker_name_enc, booker_id_enc, created_at) VALUES(?,?,?,?,?,?,?,?)',
      [token, kh, date, slot_id, party_size, await enc(name), booker_id ? await enc(booker_id) : null, now]
    );
    for (const cn of companions) {
      await db.run('INSERT INTO companions(booking_id, name_enc) VALUES(?,?)', [ins.insertId, await enc(cn)]);
    }
  } catch (e) {
    // 补偿：回滚名额，并区分重复预约
    await db.run('UPDATE slots SET available = MIN(capacity, available+?) WHERE id=?', [party_size, slot_id]);
    if (isUniqueError(e)) return fail('DUPLICATE', '您今天已预约过该活动', 409);
    throw e;
  }
  return { ok: true, code: 'OK', token, http: 200 };
}

// ---------- 取消（释放名额） ----------
export async function bookingCancel(db, cfg, token) {
  const b = await db.first('SELECT * FROM bookings WHERE token=?', [token]);
  if (!b) return { ok: false, msg: '预约不存在', http: 404 };
  if (b.status === 'active') {
    await db.run('UPDATE slots SET available = MIN(capacity, available+?) WHERE id=?', [b.party_size, b.slot_id]);
    await db.run("UPDATE bookings SET status='cancelled' WHERE token=?", [token]);
  }
  return { ok: true, http: 200 };
}

// ---------- 扫码核销 ----------
export async function bookingCheckin(db, cfg, token) {
  const b = await db.first('SELECT * FROM bookings WHERE token=?', [token]);
  if (!b) return { ok: false, msg: '二维码无效', http: 200 };
  if (b.status !== 'active') return { ok: false, msg: '该预约已取消，二维码失效', http: 200 };
  if (b.attended) return { ok: true, msg: '已核销，请勿重复', http: 200 };
  await db.run('UPDATE bookings SET attended=1 WHERE token=?', [token]);
  return { ok: true, msg: '核销成功，欢迎体验！', http: 200 };
}

// ---------- 预约详情（供成功页/取消页展示） ----------
export async function getBookingView(db, token) {
  const b = await db.first('SELECT * FROM bookings WHERE token=?', [token]);
  if (!b) return null;
  const slot = await db.first('SELECT * FROM slots WHERE id=?', [b.slot_id]);
  const compRows = await db.all('SELECT name_enc FROM companions WHERE booking_id=?', [b.id]);
  const companions = await Promise.all(compRows.map((r) => dec(r.name_enc)));
  return {
    token,
    name: await dec(b.booker_name_enc),
    party_size: b.party_size,
    date: slot.date,
    start: slot.start_time,
    end: slot.end_time,
    status: b.status,
    attended: b.attended,
    companions,
  };
}

// ---------- 管理员 ----------
export async function adminLogin(db, cfg, password) {
  if (password !== cfg.ADMIN_PASSWORD) return { ok: false, msg: '密码错误', http: 401 };
  const sid = newToken();
  const now = new Date().toISOString().slice(0, 19);
  await db.run('INSERT INTO admin_sessions(sid, created_at) VALUES(?,?)', [sid, now]);
  return { ok: true, sid, http: 200 };
}

export async function adminAuth(db, sid) {
  if (!sid) return false;
  const r = await db.first('SELECT 1 AS ok FROM admin_sessions WHERE sid=?', [sid]);
  return !!r;
}

export async function adminLogout(db, sid) {
  if (sid) await db.run('DELETE FROM admin_sessions WHERE sid=?', [sid]);
  return { ok: true };
}

export async function getDashboard(db) {
  const rows = await db.all(
    'SELECT b.*, s.date, s.start_time, s.end_time FROM bookings b JOIN slots s ON b.slot_id=s.id ORDER BY s.date, s.start_time, b.id'
  );
  const out = [];
  for (const r of rows) {
    const compRows = await db.all('SELECT name_enc FROM companions WHERE booking_id=?', [r.id]);
    const companions = await Promise.all(compRows.map((x) => dec(x.name_enc)));
    out.push({
      id: r.id,
      date: r.date,
      start: r.start_time,
      end: r.end_time,
      name: await dec(r.booker_name_enc),
      idnum: r.booker_id_enc ? await dec(r.booker_id_enc) : '',
      companions,
      party_size: r.party_size,
      status: r.status,
      attended: r.attended,
      created_at: r.created_at,
    });
  }
  return out;
}

export async function markAttended(db, id) {
  await db.run("UPDATE bookings SET attended=1 WHERE id=? AND status='active'", [id]);
  return { ok: true };
}

export async function cleanupOld(db, retentionDays) {
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString().slice(0, 19);
  const ids = await db.all('SELECT id FROM bookings WHERE created_at < ?', [cutoff]);
  for (const r of ids) await db.run('DELETE FROM companions WHERE booking_id=?', [r.id]);
  await db.run('DELETE FROM bookings WHERE created_at < ?', [cutoff]);
  return { ok: true, deleted: ids.length };
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export async function exportCsv(db) {
  const rows = await getDashboard(db);
  const header = ['预约ID', '日期', '时段', '主预约人', '身份证', '随行人', '总人数', '状态', '是否到场', '预约时间'];
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) {
    const status = r.status !== 'active' ? '已取消' : r.attended ? '已到场' : '未到场';
    lines.push(
      [
        r.id,
        r.date,
        `${r.start}-${r.end}`,
        r.name,
        r.idnum,
        r.companions.join('、'),
        r.party_size,
        status,
        r.attended ? '是' : '否',
        r.created_at,
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return lines.join('\r\n');
}
