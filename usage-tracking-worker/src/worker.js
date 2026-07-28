import { resolveShopFromOrigin, todayBerlin, kvKeyForShopDate, KV_TTL_SECONDS } from './logic.js';

async function handlePing(request, env) {
  const origin = request.headers.get('Origin');
  const shop = resolveShopFromOrigin(origin);

  if (request.method === 'OPTIONS') {
    if (!shop) {
      return new Response(null, { status: 403 });
    }
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  if (!shop) {
    return new Response('Forbidden', { status: 403 });
  }

  const key = kvKeyForShopDate(shop, todayBerlin());
  const current = parseInt((await env.USAGE_KV.get(key)) || '0', 10);
  await env.USAGE_KV.put(key, String(current + 1), { expirationTtl: KV_TTL_SECONDS });

  return new Response('OK', {
    status: 200,
    headers: { 'Access-Control-Allow-Origin': origin },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/ping') {
      return new Response('Not found', { status: 404 });
    }
    return handlePing(request, env);
  },
};
