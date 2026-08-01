// 本地预览服务（零依赖，仅用 Node 内置 node:sqlite + 真实业务逻辑 logic.js）
// 用途：在不装 wrangler / MySQL 的情况下，把 public/ 真页面 + 真实接口跑通，方便本地看效果。
// 用法：node preview-server.mjs   然后浏览器打开 http://localhost:4173
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { initCrypto } from './src/crypto.js';
import {
  makeConfig, seedIfEmpty,
  bookingCreate, bookingCancel, bookingCheckin, getBookingView,
  adminLogin, adminAuth, adminLogout, getDashboard, markAttended, cleanupOld, exportCsv,
  maskName, maskPhone, maskIdNum,
} from './src/logic.js';
import { dec } from './src/crypto.js';

// 预览用密钥（仅本地；生产请用 Cloudflare secret / CloudBase 环境变量）
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'MTIzNDU2Nzg5MGFiY2RlZmdoaWprbG1ub3BxcnN0dXY=';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '404112';
process.env.PEPPER = process.env.PEPPER || 'preview_pepper';

const ROOT = join(process.cwd(), 'public');
// preview 用本地 db（项目根 .preview.db），方便清理与排查
const DB_PATH = join(process.cwd(), '.preview.db');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const db = new DatabaseSync(DB_PATH);
await db.exec(await readFile(join(process.cwd(), 'migrations', '0001_init.sql'), 'utf8'));
// 幂等迁移：0002 给 bookings 加 short_code / phone_enc，老库也能跑
function tableInfo(t) { return db.prepare(`PRAGMA table_info(${t})`).all(); }
const cols = tableInfo('bookings').map((c) => c.name);
if (!cols.includes('short_code')) {
  db.exec('ALTER TABLE bookings ADD COLUMN short_code TEXT');
}
if (!cols.includes('phone_enc')) {
  db.exec('ALTER TABLE bookings ADD COLUMN phone_enc TEXT');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_short_code ON bookings(short_code)');
db.exec('CREATE INDEX IF NOT EXISTS idx_short_code ON bookings(short_code)');

const adapter = {
  async all(sql, params = []) { return db.prepare(sql).all(...params); },
  async first(sql, params = []) { const r = db.prepare(sql).get(...params); return r ?? null; },
  async run(sql, params = []) {
    const s = db.prepare(sql);
    const r = s.run(...params);
    return { changes: r.changes ?? 0, insertId: Number(r.lastInsertRowid ?? 0) };
  },
};

const config = makeConfig(process.env);
initCrypto(config.ENCRYPTION_KEY);
await seedIfEmpty(adapter, config.CAPACITY);

// ---- 极简路由（直接调用 logic.js，等价于 app.js 的 Hono 版本）----
function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}
async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : {};
}
function getSid(req) {
  const c = (req.headers && (req.headers.cookie || req.headers.Cookie)) || '';
  const m = c.match(/(?:^|;\s*)sid=([^;]+)/);
  return m ? m[1] : null;
}
async function requireAdmin(req) {
  const sid = getSid(req);
  return sid ? await adminAuth(adapter, sid) : false;
}

async function handleApi(req, url) {
  const p = url.pathname;
  const method = req.method;

  if (p === '/api/slots') {
    const date = urlsearch(url, 'date');
    const rows = date
      ? await adapter.all('SELECT * FROM slots WHERE date=? ORDER BY start_time', [date])
      : await adapter.all('SELECT * FROM slots ORDER BY date, start_time');
    return json(rows);
  }

  if (p === '/api/book' && method === 'POST') {
    const body = await readJson(req);
    const res = await bookingCreate(adapter, config, body);
    return json({ ok: res.ok, ...(res.token ? { token: res.token } : {}), ...(res.short_code ? { short_code: res.short_code } : {}), msg: res.msg || '' }, res.http);
  }

  if (p.startsWith('/api/booking/')) {
    const v = await getBookingView(adapter, p.slice('/api/booking/'.length));
    return v ? json({ ok: true, ...v }) : json({ ok: false, msg: '预约不存在' }, 404);
  }

  if (p.startsWith('/api/cancel/') && method === 'POST') {
    const res = await bookingCancel(adapter, config, p.slice('/api/cancel/'.length));
    return json(res, res.http);
  }

  if (p.startsWith('/api/erase/') && method === 'POST') {
    const token = p.slice('/api/erase/'.length);
    const b = await adapter.first('SELECT * FROM bookings WHERE token=?', [token]);
    if (b) {
      if (b.status === 'active') {
        await adapter.run('UPDATE slots SET available = MIN(capacity, available+?) WHERE id=?', [b.party_size, b.slot_id]);
      }
      await adapter.run('DELETE FROM companions WHERE booking_id=?', [b.id]);
      await adapter.run("UPDATE bookings SET status='cancelled', booker_name_enc='', booker_id_enc='', phone_enc='' WHERE token=?", [token]);
    }
    return json({ ok: true, msg: '已立即销毁您的所有个人信息' });
  }

  if (p.startsWith('/api/checkin/') && method === 'POST') {
    const code = p.slice('/api/checkin/'.length);
    const res = await bookingCheckin(adapter, config, code);
    if (res.ok) {
      let b = null;
      if (/^\d{6}$/.test(code)) b = await adapter.first('SELECT * FROM bookings WHERE short_code=?', [code]);
      else b = await adapter.first('SELECT * FROM bookings WHERE token=?', [code]);
      if (b) {
        const slot = await adapter.first('SELECT * FROM slots WHERE id=?', [b.slot_id]);
        const nameFull = await dec(b.booker_name_enc);
        const idFull = b.booker_id_enc ? await dec(b.booker_id_enc) : '';
        const phoneFull = b.phone_enc ? await dec(b.phone_enc) : '';
        res.booking = {
          short_code: b.short_code,
          name: nameFull, name_mask: maskName(nameFull),
          phone: phoneFull, phone_mask: maskPhone(phoneFull),
          idnum: idFull, idnum_mask: maskIdNum(idFull),
          party_size: b.party_size,
          date: slot.date, start: slot.start_time, end: slot.end_time,
        };
      }
    }
    return json(res, res.http);
  }

  if (p === '/api/admin/login' && method === 'POST') {
    const body = await readJson(req);
    const res = await adminLogin(adapter, config, body.password);
    if (!res.ok) return json({ ok: false, msg: res.msg }, res.http);
    const cookie = `sid=${res.sid }; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`;
    return json({ ok: true }, 200, { 'Set-Cookie': cookie });
  }

  if (p === '/api/admin/me') {
    return (await requireAdmin(req)) ? json({ ok: true }) : json({ ok: false }, 401);
  }

  if (p === '/api/admin/dashboard') {
    if (!(await requireAdmin(req))) return json({ ok: false, msg: '未登录' }, 401);
    let list = await getDashboard(adapter);
    const date = urlsearch(url, 'date');
    const status = urlsearch(url, 'status');
    if (date) list = list.filter((x) => x.date === date);
    if (status === 'active') list = list.filter((x) => x.status === 'active' && !x.attended);
    else if (status === 'attended') list = list.filter((x) => x.attended);
    else if (status === 'cancelled') list = list.filter((x) => x.status !== 'active');
    return json({ ok: true, list });
  }

  if (p === '/api/admin/flow') {
    if (!(await requireAdmin(req))) return json({ ok: false, msg: '未登录' }, 401);
    const rows = await adapter.all("SELECT * FROM bookings WHERE attended=1 ORDER BY id DESC LIMIT 50");
    const out = await Promise.all(rows.map(async (r) => {
      const slot = await adapter.first('SELECT * FROM slots WHERE id=?', [r.slot_id]);
      const nameFull = await dec(r.booker_name_enc);
      const idFull = r.booker_id_enc ? await dec(r.booker_id_enc) : '';
      const phoneFull = r.phone_enc ? await dec(r.phone_enc) : '';
      return {
        time: r.created_at,
        short_code: r.short_code,
        name_mask: maskName(nameFull),
        idnum_mask: maskIdNum(idFull),
        phone_mask: maskPhone(phoneFull),
        date: slot.date, start: slot.start_time, end: slot.end_time,
      };
    }));
    return json({ ok: true, list: out });
  }

  if (p === '/api/admin/export') {
    if (!(await requireAdmin(req))) return json({ ok: false, msg: '未登录' }, 401);
    const csv = await exportCsv(adapter);
    return new Response('﻿' + csv, {
      status: 200,
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="signup_export.csv"' },
    });
  }

  if (p.startsWith('/api/admin/checkin/') && method === 'POST') {
    if (!(await requireAdmin(req))) return json({ ok: false, msg: '未登录' }, 401);
    await markAttended(adapter, p.slice('/api/admin/checkin/'.length));
    return json({ ok: true });
  }

  if (p.startsWith('/api/admin/cancel/') && method === 'POST') {
    if (!(await requireAdmin(req))) return json({ ok: false, msg: '未登录' }, 401);
    const id = p.slice('/api/admin/cancel/'.length);
    const b = await adapter.first("SELECT * FROM bookings WHERE id=? AND status='active'", [id]);
    if (b) {
      await adapter.run('UPDATE slots SET available = MIN(capacity, available+?) WHERE id=?', [b.party_size, b.slot_id]);
      await adapter.run("UPDATE bookings SET status='cancelled' WHERE id=?", [id]);
    }
    return json({ ok: true });
  }

  if (p === '/api/admin/cleanup' && method === 'POST') {
    if (!(await requireAdmin(req))) return json({ ok: false, msg: '未登录' }, 401);
    const r = await cleanupOld(adapter, config.RETENTION_DAYS);
    return json({ ok: true, ...r });
  }

  if (p === '/api/admin/logout' && method === 'POST') {
    await adminLogout(adapter, getSid(req));
    return json({ ok: true }, 200, { 'Set-Cookie': 'sid=; Path=/; Max-Age=0' });
  }

  return json({ ok: false, msg: 'not found' }, 404);
}

function urlsearch(url, key) {
  const v = url.href.match(new RegExp('[?&]' + key + '=([^&]*)'));
  return v ? decodeURIComponent(v[1]) : null;
}

// ---- 静态服务（含 /success|/cancel|/checkin 动态路径重写）----
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const response = await handleApi(req, url);
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      const buf = Buffer.from(await response.arrayBuffer());
      return res.end(buf);
    }
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    else if (/^\/(success|cancel|checkin)\//.test(p)) p = '/' + p.split('/')[1] + '.html';
    const filePath = normalize(join(ROOT, p));
    if (!filePath.startsWith(ROOT)) { res.statusCode = 403; return res.end('forbidden'); }
    try {
      const data = await readFile(filePath);
      res.setHeader('Content-Type', MIME[extname(filePath)] || 'application/octet-stream');
      return res.end(data);
    } catch {
      res.statusCode = 404;
      return res.end('not found');
    }
  } catch (e) {
    res.statusCode = 500;
    res.end('error: ' + (e && e.stack ? e.stack : e));
  }
});

const PORT = Number(process.env.PORT || 4173);
server.listen(PORT, () => console.log('预览已启动： http://localhost:' + PORT));
