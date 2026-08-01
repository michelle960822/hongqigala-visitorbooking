// Cloudflare D1 数据库适配器
// 统一接口：all(sql, params) -> 行数组; first(sql, params) -> 单行或 null; run(sql, params) -> {changes, insertId}

export function makeD1(db) {
  return {
    async all(sql, params = []) {
      const r = await db.prepare(sql).bind(...params).all();
      return r.results ?? [];
    },
    async first(sql, params = []) {
      const r = await db.prepare(sql).bind(...params).first();
      return r ?? null;
    },
    async run(sql, params = []) {
      const r = await db.prepare(sql).bind(...params).run();
      return {
        changes: r.meta?.changes ?? 0,
        insertId: r.meta?.last_row_id ?? 0,
      };
    },
  };
}
