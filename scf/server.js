// 腾讯云 CloudBase（云托管）入口：用 Node 监听 PORT 提供 HTTP 服务。
// 复用与 Cloudflare 完全相同的业务逻辑与 Hono 路由，仅数据库适配换成 MySQL。
import { serve } from '@hono/node-server';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from '../src/app.js';
import { makeConfig, seedIfEmpty } from '../src/logic.js';
import { createMysqlDb } from './db-mysql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const env = process.env;
const db = createMysqlDb(env);
const config = makeConfig(env);

await seedIfEmpty(db, config.CAPACITY);

const app = buildApp({ db, config, assets: null });

// 静态文件兜底（云托管没有 ASSETS binding，直接读 public/ 目录）
app.all('*', async (c) => {
  let p = decodeURIComponent(new URL(c.req.url).pathname);
  // 动态路径重写到对应 HTML 文件
  if (/^\/success\//.test(p)) p = '/success.html';
  else if (/^\/cancel\//.test(p)) p = '/cancel.html';
  else if (/^\/checkin\//.test(p)) p = '/checkin.html';
  if (p === '/' || p === '') p = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(p));
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return c.text('not found', 404);
  }
  const ext = path.extname(filePath);
  const ctype =
    ext === '.html' ? 'text/html; charset=utf-8'
    : ext === '.css' ? 'text/css; charset=utf-8'
    : ext === '.js' ? 'application/javascript; charset=utf-8'
    : ext === '.svg' ? 'image/svg+xml'
    : 'application/octet-stream';
  return c.body(fs.readFileSync(filePath), 200, { 'Content-Type': ctype });
});

const port = Number(env.PORT) || 3000;
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`预约系统已启动： http://localhost:${info.port}  （后台 /admin.html）`);
});
