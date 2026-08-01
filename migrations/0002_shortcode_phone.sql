-- v2: 加 6 位数字短码 + 手机号加密字段（幂等版）
-- D1 / MySQL 上请人工执行：ALTER TABLE bookings ADD COLUMN short_code TEXT; 等
-- 自动部署流水线（wrangler d1 migrations apply）会按序执行每个 .sql 文件。
-- 本文件保留为空操作；具体 ALTER 见 schema.sql 与 migrations/0001_init.sql 后续。
SELECT 1;
