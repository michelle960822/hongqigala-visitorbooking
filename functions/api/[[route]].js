// Pages Functions — 直连 D1
export const onRequest = async (ctx) => {
  const { buildApp } = await import('../../src/app.js');
  const { initCrypto } = await import('../../src/crypto.js');
  const { makeD1 } = await import('../../src/db-d1.js');

  initCrypto('RGVmYXVsdEtleUZvckRldmVsb3BtZW50T25seSE=');

  const app = buildApp({
    db: makeD1(ctx.env.DB),
    config: {
      ENCRYPTION_KEY: 'RGVmYXVsdEtleUZvckRldmVsb3BtZW50T25seSE=',
      ADMIN_PASSWORD: '888888',
      RETENTION_DAYS: '10',
      REQUIRE_ID: '1',
      CAPACITY: '30',
      PEPPER: 'change_me_pepper',
    },
    assets: null,
  });

  return app.fetch(ctx.request, ctx.env);
};
