// Cloudflare Workers 入口
import { buildApp } from './app.js';
import { makeD1 } from './db-d1.js';
import { makeConfig, seedIfEmpty } from './logic.js';

export default {
  async fetch(request, env, ctx) {
    const db = makeD1(env.DB);
    const config = makeConfig(env);
    // 首次运行写入时段种子（幂等，开销极小）
    await seedIfEmpty(db, config.CAPACITY);
    const app = buildApp({ db, config, assets: env.ASSETS });
    return app.fetch(request, env, ctx);
  },
};
