// /cancel/:token → cancel.html
export const onRequest = async (ctx) => {
  const r = await fetch(new URL('/cancel.html', ctx.request.url));
  return new Response(r.body, { headers: { 'content-type': 'text/html' } });
};
