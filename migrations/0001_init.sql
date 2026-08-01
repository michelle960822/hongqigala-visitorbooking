-- Cloudflare D1 初始化（首次部署时执行：wrangler d1 migrations apply <db>）
CREATE TABLE IF NOT EXISTS slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  available INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  booker_key_hash TEXT NOT NULL,
  booking_date TEXT NOT NULL,
  slot_id INTEGER NOT NULL,
  party_size INTEGER NOT NULL,
  booker_name_enc TEXT NOT NULL,
  booker_id_enc TEXT,
  attended INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS companions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  name_enc TEXT NOT NULL
);

-- 一人一天一时段（仅对有效预约生效）
CREATE UNIQUE INDEX IF NOT EXISTS uq_booker_date ON bookings(booker_key_hash, booking_date) WHERE status='active';

-- 管理员会话（持久化，跨 Worker 实例有效）
CREATE TABLE IF NOT EXISTS admin_sessions (
  sid TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

-- 时段种子（幂等写入）
INSERT INTO slots (date, start_time, end_time, capacity, available)
SELECT '2026-08-14','14:00','16:00',30,30
WHERE NOT EXISTS (SELECT 1 FROM slots WHERE date='2026-08-14' AND start_time='14:00');

INSERT INTO slots (date, start_time, end_time, capacity, available)
SELECT '2026-08-14','16:00','18:00',30,30
WHERE NOT EXISTS (SELECT 1 FROM slots WHERE date='2026-08-14' AND start_time='16:00');

INSERT INTO slots (date, start_time, end_time, capacity, available)
SELECT '2026-08-15','10:00','12:00',30,30
WHERE NOT EXISTS (SELECT 1 FROM slots WHERE date='2026-08-15' AND start_time='10:00');

INSERT INTO slots (date, start_time, end_time, capacity, available)
SELECT '2026-08-15','12:00','14:00',30,30
WHERE NOT EXISTS (SELECT 1 FROM slots WHERE date='2026-08-15' AND start_time='12:00');

INSERT INTO slots (date, start_time, end_time, capacity, available)
SELECT '2026-08-15','14:00','16:00',30,30
WHERE NOT EXISTS (SELECT 1 FROM slots WHERE date='2026-08-15' AND start_time='14:00');

INSERT INTO slots (date, start_time, end_time, capacity, available)
SELECT '2026-08-15','16:00','18:00',30,30
WHERE NOT EXISTS (SELECT 1 FROM slots WHERE date='2026-08-15' AND start_time='16:00');
