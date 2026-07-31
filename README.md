# 汽车体验活动 · 预约核销系统

一个可直接运行的网页应用：游客扫码预约日期/时段 → 到场扫二维码核销 → 管理员导出名单。
无需安装数据库，数据存在本地 `data.db`。

## 功能
- 预约：选日期（8/14、8/15）→ 选时段 → 填姓名（+选填身份证）→ 最多 2 名随行人
- 限额：每时段默认 30 人，约满即止；一个人一天只能约一个时段
- 取消：随时取消，名额实时 +1 释放，二维码立即失效
- 核销：到场扫自己的二维码自动标记已到场；管理员也可在后台手动标记
- 导出：管理员后台一键导出 CSV，区分"已到场 / 预约未到 / 已取消"
- 安全：姓名/身份证 AES 加密存储；超过 30 天记录可一键清理
- 管理后台：`/admin`，密码见 `.env` 的 `ADMIN_PASSWORD`（默认 404112，请修改）

## 本地运行（两步，零依赖）
1. 安装 Python 3.8+（系统自带即可，无需 pip install 任何东西）
2. 启动：
   ```
   python app.py
   ```
   浏览器打开 http://localhost:5000 即可。管理后台在 http://localhost:5000/admin

> 零第三方依赖：仅用 Python 标准库 + 内嵌的 `qrcodegen.py`（纯 Python 二维码生成器，MIT 协议）。
> 首次启动会自动生成 `.env` 里的 `ENCRYPTION_KEY`（数据加密密钥），请勿泄露或删除。

## 部署到线上（给同事/客人用）
把本仓库推到 GitHub，然后连到任意支持 Python 的云平台（Render / Railway / 腾讯云 EdgeOne Makers 等）即可。
平台环境变量里设置 `PORT`（平台通常会自动给）、`ADMIN_PASSWORD`、`ENCRYPTION_KEY` 等。

## 目录结构
```
app.py              # 后端 + 所有接口
templates/          # 网页页面
static/             # 样式与脚本
data.db             # 自动生成的本地数据库（不入库）
.env                # 密钥配置（不入库，参考 .env.example）
```

## 配置项（写在 .env）
| 变量 | 说明 | 默认 |
|------|------|------|
| ADMIN_PASSWORD | 管理后台密码 | 404112 |
| ENCRYPTION_KEY | 数据加密密钥（自动生成） | 自动 |
| PEPPER | 身份证/姓名哈希盐值 | change_me_pepper |
| REQUIRE_ID | 1=强制主预约人实名（填身份证并校验） | 0 |
| CAPACITY | 每时段名额 | 30 |
| RETENTION_DAYS | 信息留存天数，过期可清理 | 30 |
| PORT | 服务端口 | 5000 |
