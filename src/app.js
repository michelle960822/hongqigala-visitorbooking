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
      { ok: res.ok, ...(res.token ? { token: res.token } : {}), ...(res.short_code ? { short_code: res.short_code } : {}), msg: res.msg || '' },
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

  // 立即销毁：取消预约 + 立刻删除所有字段（满足 PIPL "提前删除"诉求）
  app.post('/api/erase/:token', async (c) => {
    const token = c.req.param('token');
    const b = await db.first('SELECT * FROM bookings WHERE token=?', [token]);
    if (!b) return c.json({ ok: true, msg: '记录不存在或已删除' });
    if (b.status === 'active') {
      await db.run('UPDATE slots SET available = MIN(capacity, available+?) WHERE id=?', [b.party_size, b.slot_id]);
    }
    await db.run('DELETE FROM companions WHERE booking_id=?', [b.id]);
    await db.run("UPDATE bookings SET status='cancelled', booker_name_enc='', booker_id_enc='', phone_enc='' WHERE token=?", [token]);
    return c.json({ ok: true, msg: '已立即销毁您的所有个人信息' });
  });

  // 扫码核销（支持 6 位短码或完整 token）
  app.post('/api/checkin/:code', async (c) => {
    const res = await bookingCheckin(db, config, c.req.param('code'));
    // 成功时附带脱敏详情供前端展示
    if (res.ok) {
      const code = c.req.param('code');
      let b = null;
      if (/^\d{6}$/.test(code)) {
        b = await db.first('SELECT * FROM bookings WHERE short_code=?', [code]);
      } else {
        b = await db.first('SELECT * FROM bookings WHERE token=?', [code]);
      }
      if (b) {
        const slot = await db.first('SELECT * FROM slots WHERE id=?', [b.slot_id]);
        const { maskName, maskPhone, maskIdNum } = await import('./logic.js');
        const { enc, dec } = await import('./crypto.js');
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

  // 管理员登录态查询
  app.get('/api/admin/me', async (c) => {
    const sid = getCookie(c, 'sid');
    if (await adminAuth(db, sid)) return c.json({ ok: true });
    return c.json({ ok: false }, 401);
  });

  // 管理员鉴权中间件
  const requireAdmin = async (c, next) => {
    const sid = getCookie(c, 'sid');
    if (!(await adminAuth(db, sid))) return c.json({ ok: false, msg: '未登录' }, 401);
    await next();
  };

  // 后台数据（带日期/状态过滤，返回 list 字段以兼容旧版）
  app.get('/api/admin/dashboard', requireAdmin, async (c) => {
    const date = c.req.query('date');
    const status = c.req.query('status');
    let list = await getDashboard(db);
    if (date) list = list.filter((x) => x.date === date);
    if (status === 'active') list = list.filter((x) => x.status === 'active' && !x.attended);
    else if (status === 'attended') list = list.filter((x) => x.attended);
    else if (status === 'cancelled') list = list.filter((x) => x.status !== 'active');
    return c.json({ ok: true, list });
  });

  // 今日核销流水（按 attended 倒序）
  app.get('/api/admin/flow', requireAdmin, async (c) => {
    const { maskName, maskPhone, maskIdNum } = await import('./logic.js');
    const { dec } = await import('./crypto.js');
    const rows = await db.all("SELECT * FROM bookings WHERE attended=1 ORDER BY id DESC LIMIT 50");
    const out = await Promise.all(rows.map(async (r) => {
      const slot = await db.first('SELECT * FROM slots WHERE id=?', [r.slot_id]);
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
    return c.json({ ok: true, list: out });
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

  // 取消标记
  app.post('/api/admin/unmark/:id', requireAdmin, async (c) => {
    await db.run('UPDATE bookings SET attended=0 WHERE id=?', [c.req.param('id')]);
    return c.json({ ok: true });
  });

  // 管理员取消预约（释放名额）
  app.post('/api/admin/cancel/:id', requireAdmin, async (c) => {
    const id = c.req.param('id');
    const b = await db.first("SELECT * FROM bookings WHERE id=? AND status='active'", [id]);
    if (b) {
      await db.run('UPDATE slots SET available = MIN(capacity, available+?) WHERE id=?', [b.party_size, b.slot_id]);
      await db.run("UPDATE bookings SET status='cancelled' WHERE id=?", [id]);
    }
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
