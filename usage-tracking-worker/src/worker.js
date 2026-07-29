import {
  resolveShopFromOrigin,
  todayBerlin,
  yesterdayBerlin,
  kvKeyForShopDate,
  KV_TTL_SECONDS,
  buildReportEmail,
  SHOP_IDS,
} from './logic.js';

async function handleCounterEvent(request, env, metricPrefix) {
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

  const key = kvKeyForShopDate(metricPrefix, shop, todayBerlin());
  try {
    const current = parseInt((await env.USAGE_KV.get(key)) || '0', 10);
    await env.USAGE_KV.put(key, String(current + 1), { expirationTtl: KV_TTL_SECONDS });
  } catch (err) {
    console.error('[usage-tracking] KV-Fehler beim Zaehlen (' + metricPrefix + '):', err);
    return new Response('Internal error', {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': origin },
    });
  }

  return new Response('OK', {
    status: 200,
    headers: { 'Access-Control-Allow-Origin': origin },
  });
}

async function sendDailyReport(env) {
  const dateStr = yesterdayBerlin();
  const counts = {};
  for (const shop of SHOP_IDS) {
    const value = await env.USAGE_KV.get(kvKeyForShopDate('count', shop, dateStr));
    counts[shop] = parseInt(value || '0', 10);
  }

  const { subject, text } = buildReportEmail({ dateStr, counts });

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.REPORT_FROM_EMAIL,
        to: env.REPORT_TO_EMAIL,
        subject: subject,
        text: text,
      }),
    });

    const body = await response.text();
    if (response.ok) {
      console.log('[usage-tracking] Resend-Antwort:', response.status, body);
    } else {
      console.error('[usage-tracking] Resend-Fehler:', response.status, body);
    }
  } catch (err) {
    console.error('[usage-tracking] Netzwerkfehler beim Versand des Tagesreports:', err);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ping') {
      return handleCounterEvent(request, env, 'count');
    }
    if (url.pathname === '/click') {
      return handleCounterEvent(request, env, 'clicks');
    }
    if (url.pathname === '/cart') {
      return handleCounterEvent(request, env, 'cart');
    }
    return new Response('Not found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendDailyReport(env));
  },
};
