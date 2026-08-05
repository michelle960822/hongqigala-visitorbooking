// Pages Functions — 全功能直连 D1
import { buildApp } from '../../src/app.js';

let app = null;

export const onRequest = async (ctx) => {
  if (!app) {
    app = buildApp({
      db: ctx.env.DB,
      config: {
        ENCRYPTION_KEY: ctx.env.ENCRYPTION_KEY || 'RGVmYXVsdEtleUZvckRldmVsb3BtZW50T25seSE=', 
        ADMIN_PASSWORD: ctx.env.ADMIN_PASSWORD || '888888',
        RETENTION_DAYS: ctx.env.RETENTION_DAYS || '10',
        REQUIRE_ID: ctx.env.REQUIRE_ID || '1',
        CAPACITY: ctx.env.CAPACITY || '30',
        PEPPER: ctx.env.PEPPER || 'change_me_pepper',
      },
      assets: null,
    });
  }
  return app.fetch(ctx.request, ctx.env);
};
