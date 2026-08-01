// 腾讯云 CloudBase（云托管）MySQL 适配器
// 与 D1 实现相同接口：all / first / run
import mysql from 'mysql2/promise';

let pool = null;

export function createMysqlDb(env) {
  const cfg = env.MYSQL_URL
    ? { uri: env.MYSQL_URL }
    : {
        host: env.MYSQL_HOST,
        user: env.MYSQL_USER,
        password: env.MYSQL_PASSWORD,
        database: env.MYSQL_DATABASE,
        port: env.MYSQL_PORT ? Number(env.MYSQL_PORT) : 3306,
        waitForConnections: true,
        connectionLimit: 10,
      };
  pool = mysql.createPool(cfg);
  return {
    async all(sql, params = []) {
      const [rows] = await pool.query(sql, params);
      return rows;
    },
    async first(sql, params = []) {
      const [rows] = await pool.query(sql, params);
      return rows[0] ?? null;
    },
    async run(sql, params = []) {
      const [r] = await pool.query(sql, params);
      return { changes: r.affectedRows, insertId: r.insertId };
    },
  };
}
