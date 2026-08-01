// Hono 应用（平台无关）：所有 API 返回 JSON，前端页面为静态文件（由 ASSETS / 静态服务器提供）。
import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { initCrypto } from './crypto.js';
import {
  bookingCreate,
  bookingCancel,
  bookingCheckin,
  getBookingView,
  adminLogin,
  adminAuth,
  adminLogout,
  getDashboard,
  markAttended,
  cleanupOld,
  exportCsv,
} from './logic.js';

export function buildApp({ db, config, assets }) {
  initCrypto(config.ENCRYPTION_KEY);
  const app = new Hono();

  // 预约页拉取时段余量
  app.get('/api/slots', async (c) => {
    const date = c.req.query('date');
    const rows = date
      ? await db.all('SELECT * FROM slots WHERE date=? ORDER BY start_time', [date])
      : await db.all('SELECT * FROM slots ORDER BY date, start_time');
    return c.json(rows);
  });

  // 提交预约
  app.post('/api/book', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const res = await bookingCreate(db, config, body);
    return c.json(
      { ok: res.ok, ...(res.token ? { token: res.token } : {}), ...(res.code ? { code: res.code, msg: res.msg } : {}) },
      res.http
    );
  });

  // 预约详情（成功页/取消页用）
  app.get('/api/booking/:token', async (c) => {
    const v = await getBookingView(db, c.req.param('token'));
    if (!v) return c.json({ ok: false, msg: '预约不存在' }, 404);
    return c.json({ ok: true, ...v });
  });

  // 取消预约
  app.post('/api/cancel/:token', async (c) => {
    const res = await bookingCancel(db, config, c.req.param('token'));
    return c.json(res, res.http);
  });

  // 扫码核销
  app.post('/api/checkin/:token', async (c) => {
    const res = await bookingCheckin(db, config, c.req.param('token'));
    return c.json(res, res.http);
  });

  // 管理员登录
  app.post('/api/admin/login', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const res = await adminLogin(db, config, body.password);
    if (!res.ok) return c.json({ ok: false, msg: res.msg }, res.http);
    setCookie(c, 'sid', res.sid, { httpOnly: true, path: '/', sameSite: 'Lax', maxAge: 60 * 60 * 12 });
    return c.json({ ok: true });
  });

  // 管理员鉴权中间件
  const requireAdmin = async (c, next) => {
    const sid = getCookie(c, 'sid');
    if (!(await adminAuth(db, sid))) return c.json({ ok: false, msg: '未登录' }, 401);
    await next();
  };

  // 后台数据
  app.get('/api/admin/dashboard', requireAdmin, async (c) => {
    const rows = await getDashboard(db);
    return c.json({ ok: true, rows });
  });

  // 导出 CSV
  app.get('/api/admin/export', requireAdmin, async (c) => {
    const csv = await exportCsv(db);
    return c.body('\uFEFF' + csv, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="signup_export.csv"',
    });
  });

  // 标记到场
  app.post('/api/admin/checkin/:id', requireAdmin, async (c) => {
    await markAttended(db, c.req.param('id'));
    return c.json({ ok: true });
  });

  // 清理过期数据
  app.post('/api/admin/cleanup', requireAdmin, async (c) => {
    const r = await cleanupOld(db, config.RETENTION_DAYS);
    return c.json({ ok: true, ...r });
  });

  // 退出
  app.post('/api/admin/logout', async (c) => {
    const sid = getCookie(c, 'sid');
    await adminLogout(db, sid);
    deleteCookie(c, 'sid', { path: '/' });
    return c.json({ ok: true });
  });

  // 静态资源兜底（Cloudflare Workers 走 ASSETS binding）
  // 动态路径 /success/:token、/cancel/:token、/checkin/:token 重写到对应 HTML 文件
  if (assets) {
    app.all('*', (c) => {
      const url = new URL(c.req.url);
      const p = url.pathname;
      let file = null;
      if (/^\/success\//.test(p)) file = '/success.html';
      else if (/^\/cancel\//.test(p)) file = '/cancel.html';
      else if (/^\/checkin\//.test(p)) file = '/checkin.html';
      if (file) {
        const u = new URL(url);
        u.pathname = file;
        return assets.fetch(new Request(u.toString(), c.req.raw));
      }
      return assets.fetch(c.req.raw);
    });
  }

  return app;
}
