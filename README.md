# 汽车体验活动 · 预约核销系统（Serverless / JS 版）

面向自然游客的体验活动预约与现场核销系统。**一人一天限约一个时段、每时段限额、实名校验、加密存储、扫码核销、随时取消释放名额、管理员导出报名。**

前端为纯静态页面，后端为 **Hono** 框架，同一套业务逻辑可运行在：

- **Cloudflare Workers + D1（SQLite）** —— 推荐，免费额度足够本次活动，部署最简单；
- **腾讯云 CloudBase（云托管 + MySQL）** —— 同一套代码，仅数据库适配换成 MySQL。

> 隐私合规：姓名 / 身份证号使用 HMAC-SHA256 流密码加密存储（每条记录独立随机 nonce），导出时才解密；后台可一键清理超过留存天数的记录。

---

## 目录结构

```
src/
  crypto.js      # 加密（HMAC 流密码）、身份证校验位（MOD 11-2）
  logic.js       # 纯业务逻辑（预约/取消/核销/管理员/导出），平台无关
  db-d1.js       # Cloudflare D1 数据库适配器
  app.js         # Hono 路由（所有接口返回 JSON）
  index.js       # Cloudflare Workers 入口
migrations/
  0001_init.sql  # D1 建表 + 时段种子（8/14、8/15 共 6 个时段，每段 30 人）
public/          # 前端静态页面（index / success / cancel / checkin / admin）
  static/        # app.js、style.css、qrcode.min.js（二维码生成库）
scf/             # 腾讯云 CloudBase 入口（Node 服务器 + MySQL 适配器 + schema.sql）
test/
  smoke.mjs      # 本地逻辑冒烟测试（Node 内置 SQLite）
wrangler.toml    # Cloudflare 部署配置
package.json
```

---

## 本地测试（无需任何云平台账号）

```bash
node test/smoke.mjs     # 用 Node 内置 SQLite 跑真实 SQL，验证加密/预约/核销/导出全链路
```

---

## 部署到 Cloudflare（推荐）

### 1. 准备
```bash
npm install -g wrangler        # 或 npx wrangler
npx wrangler login             # 浏览器授权登录
```

### 2. 创建 D1 数据库
```bash
npx wrangler d1 create auto-expo-booking
```
控制台会返回 `database_id`，把它填进 `wrangler.toml` 里的 `database_id = "..."`。

### 3. 执行建表与种子
```bash
npx wrangler d1 migrations apply auto-expo-booking
```
（会应用 `migrations/0001_init.sql`，创建三张表并写入 8/14、8/15 共 6 个时段。）

### 4. 设置加密密钥（机密，不要写进代码）
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npx wrangler secret put ENCRYPTION_KEY      # 把上一步生成的字符串粘进去
```
> 也可在 `wrangler.toml` 的 `[vars]` 里改 `ADMIN_PASSWORD`（后台密码，默认 `404112`）、`CAPACITY`、`RETENTION_DAYS`、`PEPPER`、`REQUIRE_ID`。

### 5. 部署
```bash
npx wrangler deploy
```
部署完成后会得到一个 `https://auto-expo-booking.<子域>.workers.dev` 地址。

### 使用
- 预约首页：`/`
- 扫码核销（二维码内容即 `/checkin/<token>`）：手机相机扫码自动核销
- 管理员后台：`/admin.html`（密码 `404112`）
- 导出报名 CSV：`/api/admin/export`（需先登录后台）

本地调试：`npx wrangler dev`（自动使用本地 D1）。

---

## 通过 GitHub 自动同步到 Cloudflare（推荐工作流）

把代码放进 GitHub 之后，**每次 push 都会自动部署到 Cloudflare**，不用再手动跑命令。仓库里已预置了流水线文件 `.github/workflows/deploy-cloudflare.yml`。

### 一次性准备（约 5 分钟）

1. **在 github.com 新建一个空仓库**（不要勾选 README / .gitignore，保持全空）。
2. **推送代码**（你给我 GitHub 秘钥后，我可以直接帮你推；或你自己执行）：
   ```bash
   git remote add origin https://github.com/<你的用户名>/<仓库名>.git
   git push -u origin main
   ```
3. **在 GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret 添加三个机密**：
   | 名称 | 内容 |
   |------|------|
   | `CLOUDFLARE_API_TOKEN` | Cloudflare 的 API Token（权限勾 **Workers Scripts Edit** + **D1 Edit**） |
   | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 控制台右侧的账户 ID |
   | `ENCRYPTION_KEY` | 32 字节随机 base64：<br>`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
   > 可选：`ADMIN_PASSWORD`、`PEPPER`（不填则用 `wrangler.toml` 默认值）。
4. **D1 数据库仍需本地建一次**（流水线只同步代码，不创建数据库）：
   ```bash
   npx wrangler d1 create auto-expo-booking
   # 把返回的 database_id 填进 wrangler.toml 的 database_id = "..."
   npx wrangler d1 migrations apply auto-expo-booking
   ```

### 之后怎么用

- **你改了需求 → 告诉我 → 我改完代码 push → GitHub Actions 自动部署**，几十秒后线上就更新了。全程不用你碰命令行。
- 也可以在 GitHub 仓库 **Actions** 页面手动点 **Run workflow** 触发重部署。
- 安全提示：`.env` 和 `.workbuddy/` 已在 `.gitignore` 中，**不会被推到公开仓库**；所有密钥都走 GitHub Secrets / Cloudflare Secrets，不进代码。

---

## 部署到腾讯云 CloudBase（云托管 + MySQL）

同一套业务逻辑，仅数据库适配换成 MySQL。

### 1. 建 MySQL 并初始化表
在 CloudBase 控制台创建 **云数据库 MySQL**，用 `scf/schema.sql` 初始化表结构并写入时段种子。

### 2. 本地自测
```bash
cd scf
npm install
# 设置环境变量（或写进 .env 由你的启动方式读取）
export ADMIN_PASSWORD=404112
export ENCRYPTION_KEY=<base64 随机串，同 Cloudflare 第 4 步生成>
export MYSQL_HOST=<host>
export MYSQL_USER=<user>
export MYSQL_PASSWORD=<password>
export MYSQL_DATABASE=<db>
export PORT=3000
node server.js
```
浏览器打开 `http://localhost:3000` 验证（后台 `/admin.html`）。

### 3. 部署到云托管
在 CloudBase 控制台「云托管」新建服务，关联本仓库（或上传 `src/`、`scf/`、`public/`、`package.json`）。
- **构建/启动命令**：`npm install && (cd scf && npm install) && node scf/server.js`
- **监听端口**：使用环境变量 `PORT`（云托管会注入）
- **环境变量**：把上面的 `ADMIN_PASSWORD`、`ENCRYPTION_KEY`、`MYSQL_*` 设为环境变量（机密项用「保密环境变量」）
- 部署完成后用分配的域名访问，后台 `/admin.html`。

---

## 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/api/slots?date=2026-08-14` | 查询时段与剩余名额 |
| POST | `/api/book` | 提交预约（JSON：`date, slot_id, name, booker_id?, companions[]`） |
| GET  | `/api/booking/:token` | 预约详情（成功页/取消页用） |
| POST | `/api/cancel/:token` | 取消预约，实时释放名额 |
| POST | `/api/checkin/:token` | 扫码核销 |
| POST | `/api/admin/login` | 管理员登录，下发 Cookie |
| GET  | `/api/admin/dashboard` | 后台数据（需登录） |
| GET  | `/api/admin/export` | 导出 CSV（UTF-8 BOM，需登录） |
| POST | `/api/admin/checkin/:id` | 后台标记到场（需登录） |
| POST | `/api/admin/cleanup` | 清理过期数据（需登录） |
| POST | `/api/admin/logout` | 退出登录 |

---

## 关键规则（已在代码中强制）

- **一人一天一时段**：`bookings` 表对 `(booker_key_hash, booking_date)` 建唯一索引（仅 active），重复预约返回 `409 DUPLICATE`。
- **每时段限额 / 防超卖**：预约时 `UPDATE slots SET available = available - N WHERE id=? AND available >= N`，原子扣减；名额不足返回 `409 SOLD_OUT`。
- **取消释放**：取消时 `available = MIN(capacity, available + N)`，二维码立即失效。
- **实名校验**：填了身份证号即按 GB 11643（MOD 11-2）校验校验位；`REQUIRE_ID=1` 可强制必填。
- **加密存储**：姓名/身份证号/随行人姓名均加密存储，仅导出与管理员后台解密展示。

---

## 旧版说明

原先的 Python 零依赖版本已挪到 `legacy-python/`（仅作备份，不再维护）。本 JS 版为当前主版本。
