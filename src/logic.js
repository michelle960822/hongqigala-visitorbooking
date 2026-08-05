// 纯业务逻辑层：不依赖 HTTP 框架，便于在 Node 中直接单元测试。
// 数据库访问通过传入的 db 适配器（D1 / MySQL 均实现相同接口：all / first / run）。

import { enc, dec, sha256Hex, validIdOrPassport } from './crypto.js';

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

// 6 位数字短码，去重直到成功（最多 20 次）
async function newShortCode(db) {
  for (let i = 0; i < 20; i++) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
    const code = String(n).padStart(6, '0');
    const hit = await db.first('SELECT 1 AS ok FROM bookings WHERE short_code=?', [code]);
    if (!hit) return code;
  }
  // 极小概率 fallback：用 id 派生
  const row = await db.first("SELECT IFNULL(MAX(id),0)+1 AS n FROM bookings");
  return String(Number(row.n) % 1000000).padStart(6, '0');
}

// 脱敏：姓名保留首字 + *，手机 138****5678，身份证 110105********002X
export function maskName(s) {
  if (!s) return '';
  if (s.length <= 1) return s;
  return s[0] + '*'.repeat(Math.max(1, s.length - 1));
}
export function maskPhone(s) {
  if (!s) return '';
  const d = String(s).replace(/\D/g, '');
  if (d.length < 7) return d;
  return d.slice(0, 3) + '****' + d.slice(-4);
}
export function maskIdNum(s) {
  if (!s) return '';
  const raw = String(s).trim();
  // 中国身份证：18位数字+X
  const id = raw.replace(/[^\dXx]/g, '').toUpperCase();
  if (id.length === 18 && /^\d{17}[\dX]$/.test(id)) {
    return id.slice(0, 6) + '********' + id.slice(-4);
  }
  // 护照 / 其他证件：保留首尾各 2 位
  if (raw.length <= 4) return raw;
  return raw.slice(0, 2) + '***' + raw.slice(-2);
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
  const phone = (input.phone || '').trim();

  if (!name) return fail('NAME_REQUIRED', '请填写姓名', 400);
  if (cfg.REQUIRE_ID && !input.booker_id) return fail('ID_REQUIRED', '请填写身份证号或护照号', 400);
  const booker_id = (input.booker_id || '').trim();
  if (booker_id && !validIdOrPassport(booker_id)) return fail('ID_INVALID', '证件号格式错误（身份证18位或护照5–20位字母数字）', 400);
  if (phone && !/^1\d{10}$/.test(phone)) return fail('PHONE_INVALID', '请填写正确的 11 位手机号', 400);
  if (companions.length > 2) return fail('TOO_MANY', '随行人最多 2 人', 400);

  const party_size = 1 + companions.length;
  const key = booker_id || name;
  const token = newToken();
  const short_code = await newShortCode(db);
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
      'INSERT INTO bookings(token, short_code, booker_key_hash, booking_date, slot_id, party_size, booker_name_enc, booker_id_enc, phone_enc, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [token, short_code, kh, date, slot_id, party_size, await enc(name), booker_id ? await enc(booker_id) : null, phone ? await enc(phone) : null, now]
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
  return { ok: true, code: 'OK', token, short_code, http: 200 };
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

// ---------- 扫码核销（支持 token 或 6 位短码） ----------
export async function bookingCheckin(db, cfg, code) {
  if (!code) return { ok: false, msg: '请提供核销码', http: 200 };
  const c = String(code).trim();
  // 短码（6 位纯数字）
  if (/^\d{6}$/.test(c)) {
    const b = await db.first("SELECT * FROM bookings WHERE short_code=?", [c]);
    return _doCheckin(db, b, c);
  }
  const b = await db.first('SELECT * FROM bookings WHERE token=?', [c]);
  return _doCheckin(db, b, c);
}

async function _doCheckin(db, b, code) {
  if (!b) return { ok: false, msg: '核销码无效', http: 200 };
  if (b.status !== 'active') return { ok: false, msg: '该预约已取消，核销码失效', http: 200 };
  if (b.attended) return { ok: true, msg: '已核销，请勿重复', http: 200, already: true };
  await db.run('UPDATE bookings SET attended=1 WHERE token=?', [b.token]);
  return { ok: true, msg: '核销成功，欢迎体验！', http: 200 };
}

// ---------- 预约详情（供成功页/取消页展示） ----------
export async function getBookingView(db, token) {
  const b = await db.first('SELECT * FROM bookings WHERE token=?', [token]);
  if (!b) return null;
  const slot = await db.first('SELECT * FROM slots WHERE id=?', [b.slot_id]);
  const compRows = await db.all('SELECT name_enc FROM companions WHERE booking_id=?', [b.id]);
  const companions = await Promise.all(compRows.map((r) => dec(r.name_enc)));
  const nameFull = await dec(b.booker_name_enc);
  const idFull = b.booker_id_enc ? await dec(b.booker_id_enc) : '';
  const phoneFull = b.phone_enc ? await dec(b.phone_enc) : '';
  return {
    token,
    short_code: b.short_code || '',
    name: nameFull,
    name_mask: maskName(nameFull),
    phone: phoneFull,
    phone_mask: maskPhone(phoneFull),
    idnum: idFull,
    idnum_mask: maskIdNum(idFull),
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
    const nameFull = await dec(r.booker_name_enc);
    const idFull = r.booker_id_enc ? await dec(r.booker_id_enc) : '';
    const phoneFull = r.phone_enc ? await dec(r.phone_enc) : '';
    out.push({
      id: r.id,
      short_code: r.short_code || '',
      date: r.date,
      start: r.start_time,
      end: r.end_time,
      name: nameFull,
      name_mask: maskName(nameFull),
      idnum: idFull,
      idnum_mask: maskIdNum(idFull),
      phone: phoneFull,
      phone_mask: maskPhone(phoneFull),
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
