// /checkin/:token → checkin.html
export const onRequest = async (ctx) => {
  const r = await fetch(new URL('/checkin.html', ctx.request.url));
  return new Response(r.body, { headers: { 'content-type': 'text/html' } });
};
