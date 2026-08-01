// 本地冒烟测试：用 Node 内置 node:sqlite 跑真实 SQLite SQL，验证核心逻辑全链路。
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

import { initCrypto, validId } from '../src/crypto.js';
import {
  makeConfig,
  seedIfEmpty,
  bookingCreate,
  getBookingView,
  bookingCancel,
  bookingCheckin,
  adminLogin,
  adminAuth,
  adminLogout,
  getDashboard,
  exportCsv,
  markAttended,
} from '../src/logic.js';

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '  <-- FAILED'); }
}

// 生成加密密钥（base64，32 字节）
const keyBytes = crypto.getRandomValues(new Uint8Array(32));
const ENCRYPTION_KEY = btoa(String.fromCharCode(...keyBytes));
initCrypto(ENCRYPTION_KEY);

const cfg = makeConfig({ ADMIN_PASSWORD: '404112', ENCRYPTION_KEY, CAPACITY: '30', PEPPER: 'testpepper', RETENTION_DAYS: '30' });

// 内存 SQLite（与 D1 同方言）
const db = new DatabaseSync(':memory:');
const migration = readFileSync(join(root, 'migrations/0001_init.sql'), 'utf-8');
db.exec(migration);

const adapter = {
  all(sql, params = []) { return db.prepare(sql).all(...params); },
  first(sql, params = []) { const r = db.prepare(sql).get(...params); return r ?? null; },
  run(sql, params = []) { const r = db.prepare(sql).run(...params); return { changes: r.changes, insertId: Number(r.lastInsertRowid) }; },
};

await seedIfEmpty(adapter, cfg.CAPACITY);

// ---------- 1. 身份证校验 ----------
function makeValidId(base17) {
  const w = [7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2];
  const c = '10X98765432';
  let s = 0; for (let i=0;i<17;i++) s += +base17[i]*w[i];
  return base17 + c[s%11];
}
const vid = makeValidId('11010519491231002');
console.log('\n[1] 身份证校验');
ok('合法身份证通过', validId(vid) === true);
ok('位数不足被拒', validId('123') === false);
ok('校验位错误被拒', validId('110105194912310021') === false);

// ---------- 2. 加密往返 ----------
console.log('\n[2] 加密往返 (HMAC 流密码)');
import('../src/crypto.js').then(async () => {
  const { enc, dec } = await import('../src/crypto.js');
  const t1 = await enc('张三');
  const t2 = await enc('张三');
  ok('加密结果非明文', t1 !== '张三' && t2 !== '张三');
  ok('同明文密文不同（有 nonce）', t1 !== t2);
  ok('解密还原', (await dec(t1)) === '张三');
  ok('解密还原(2)', (await dec(t2)) === '张三');

  // ---------- 3. 预约 + 防超卖 ----------
  console.log('\n[3] 预约流程');
  const before = (await adapter.all('SELECT * FROM slots WHERE date=? ORDER BY start_time', ['2026-08-14']))[0].available;
  const r1 = await bookingCreate(adapter, cfg, { date: '2026-08-14', slot_id: 1, name: '张三', booker_id: vid, companions: [] });
  ok('预约成功返回 token', r1.ok === true && !!r1.token);
  const after = (await adapter.all('SELECT * FROM slots WHERE id=1'))[0].available;
  ok('名额 -1', after === before - 1);

  const view = await getBookingView(adapter, r1.token);
  ok('详情解密出姓名', view.name === '张三');
  ok('详情含时段', view.date === '2026-08-14' && view.start === '14:00');

  // 重复预约同一天同一人 -> DUPLICATE
  const dup = await bookingCreate(adapter, cfg, { date: '2026-08-14', slot_id: 1, name: '张三', booker_id: vid, companions: [] });
  ok('重复预约被拦截', dup.code === 'DUPLICATE' && dup.http === 409);
  const afterDup = (await adapter.all('SELECT * FROM slots WHERE id=1'))[0].available;
  ok('重复预约不扣名额', afterDup === after);

  // 带 2 名随行人
  const r2 = await bookingCreate(adapter, cfg, { date: '2026-08-15', slot_id: 3, name: '李四', companions: ['王五', '赵六'] });
  ok('带随行人预约成功', r2.ok === true);
  const v2 = await getBookingView(adapter, r2.token);
  ok('总人数=3（含随行）', v2.party_size === 3);
  ok('随行人解密正确', JSON.stringify(v2.companions) === JSON.stringify(['王五','赵六']));

  // 非法身份证
  const bad = await bookingCreate(adapter, cfg, { date: '2026-08-15', slot_id: 4, name: '钱七', booker_id: '123456789012345678' });
  ok('非法身份证被拒', bad.code === 'ID_INVALID');

  // ---------- 4. 取消释放名额 ----------
  console.log('\n[4] 取消与释放名额');
  const a1 = (await adapter.all('SELECT * FROM slots WHERE id=1'))[0].available;
  const c1 = await bookingCancel(adapter, cfg, r1.token);
  ok('取消成功', c1.ok === true);
  const a2 = (await adapter.all('SELECT * FROM slots WHERE id=1'))[0].available;
  ok('名额 +1 释放', a2 === a1 + 1);
  const v1c = await getBookingView(adapter, r1.token);
  ok('状态变 cancelled', v1c.status === 'cancelled');

  // ---------- 5. 核销 ----------
  console.log('\n[5] 扫码核销');
  const k1 = await bookingCheckin(adapter, cfg, r2.token);
  ok('核销成功', k1.ok === true && k1.msg.includes('核销成功'));
  const k2 = await bookingCheckin(adapter, cfg, r2.token);
  ok('重复核销不报错', k2.ok === true && k2.msg.includes('已核销'));
  const badToken = await bookingCheckin(adapter, cfg, 'not-exist');
  ok('无效二维码被拒', badToken.ok === false);
  // 已取消的不能再核销
  const kc = await bookingCheckin(adapter, cfg, r1.token);
  ok('已取消二维码失效', kc.ok === false && kc.msg.includes('失效'));

  // ---------- 6. 管理员 ----------
  console.log('\n[6] 管理员后台');
  const wrong = await adminLogin(adapter, cfg, '000000');
  ok('错误密码被拒', wrong.ok === false && wrong.http === 401);
  const login = await adminLogin(adapter, cfg, '404112');
  ok('正确密码登录', login.ok === true && !!login.sid);
  ok('会话有效', (await adminAuth(adapter, login.sid)) === true);
  const rows = await getDashboard(adapter);
  ok('后台返回解密记录', rows.some(r => r.name === '李四' && r.attended === 1));
  ok('后台解密身份证', rows.some(r => r.name === '张三' && r.idnum === vid));
  const csv = await exportCsv(adapter);
  ok('CSV 含表头', csv.includes('主预约人') && csv.includes('身份证'));
  ok('CSV 含已到场标记', csv.includes('已到场'));
  await adminLogout(adapter, login.sid);
  ok('退出后会话失效', (await adminAuth(adapter, login.sid)) === false);

  // ---------- 7. 标记到场 / 清理 ----------
  console.log('\n[7] 标记到场与清理');
  const r4 = await bookingCreate(adapter, cfg, { date: '2026-08-14', slot_id: 2, name: '孙八', booker_id: makeValidId('32010519900101001') });
  const r4row = (await getDashboard(adapter)).find(r => r.name === '孙八');
  await markAttended(adapter, r4row.id);
  ok('标记到场生效', (await getDashboard(adapter)).find(r => r.id === r4row.id).attended === 1);
  const clean = await import('../src/logic.js').then(m => m.cleanupOld(adapter, 30));
  ok('清理接口可调用', clean.ok === true);

  console.log(`\n==== 结果：${pass} 通过, ${fail} 失败 ====`);
  process.exit(fail === 0 ? 0 : 1);
});
