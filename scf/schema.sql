-- 腾讯云 CloudBase MySQL 初始化脚本（在云数据库控制台执行一次）
CREATE TABLE IF NOT EXISTS slots (
  id INT PRIMARY KEY AUTO_INCREMENT,
  date VARCHAR(20) NOT NULL,
  start_time VARCHAR(10) NOT NULL,
  end_time VARCHAR(10) NOT NULL,
  capacity INT NOT NULL,
  available INT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  token VARCHAR(64) UNIQUE NOT NULL,
  short_code VARCHAR(8),
  booker_key_hash VARCHAR(128) NOT NULL,
  booking_date VARCHAR(20) NOT NULL,
  slot_id INT NOT NULL,
  party_size INT NOT NULL,
  booker_name_enc TEXT NOT NULL,
  booker_id_enc TEXT,
  phone_enc TEXT,
  attended INT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at VARCHAR(25) NOT NULL,
  UNIQUE KEY uq_short_code (short_code),
  INDEX idx_booker_date (booker_key_hash, booking_date)
);

CREATE TABLE IF NOT EXISTS companions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  booking_id INT NOT NULL,
  name_enc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  sid VARCHAR(64) PRIMARY KEY,
  created_at VARCHAR(25) NOT NULL
);

-- 时段种子
INSERT IGNORE INTO slots (date, start_time, end_time, capacity, available) VALUES
('2026-08-14','14:00','16:00',30,30),
('2026-08-14','16:00','18:00',30,30),
('2026-08-15','10:00','12:00',30,30),
('2026-08-15','12:00','14:00',30,30),
('2026-08-15','14:00','16:00',30,30),
('2026-08-15','16:00','18:00',30,30);
