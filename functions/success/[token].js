// /success/:token → 返回 success.html（JS 从 URL pathname 读取 token）
export const onRequest = async (ctx) => {
  const r = await fetch(new URL('/success.html', ctx.request.url));
  return new Response(r.body, { headers: { 'content-type': 'text/html' } });
};
