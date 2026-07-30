const SHOP_ORIGINS = {
  'https://www.biohairbeauty.shop': 'hauptshop',
  'https://member.biohairbeauty.shop': 'member',
};

export const SHOP_IDS = ['hauptshop', 'member'];

export function resolveShopFromOrigin(origin) {
  if (!origin) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(SHOP_ORIGINS, origin)) {
    return null;
  }
  return SHOP_ORIGINS[origin];
}

const berlinDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function todayBerlin(date) {
  return berlinDateFormatter.format(date || new Date());
}

export function yesterdayBerlin(date) {
  const todayStr = todayBerlin(date);
  const [year, month, day] = todayStr.split('-').map(Number);
  const noonUtc = Date.UTC(year, month - 1, day, 12);
  const previousDay = new Date(noonUtc - 24 * 60 * 60 * 1000);
  return todayBerlin(previousDay);
}

export const KV_TTL_SECONDS = 30 * 24 * 60 * 60;

export function kvKeyForShopDate(prefix, shop, dateStr) {
  return prefix + ':' + shop + ':' + dateStr;
}

export function sessionListKvKey(metricPrefix, shop, dateStr) {
  return 'sessions:' + metricPrefix + ':' + shop + ':' + dateStr;
}

export function sessionCount(existingListJson) {
  try {
    const list = existingListJson ? JSON.parse(existingListJson) : [];
    return Array.isArray(list) ? list.length : 0;
  } catch (error) {
    return 0;
  }
}

export function addSessionIdIfMissing(existingListJson, sessionId) {
  let liste;
  try {
    liste = existingListJson ? JSON.parse(existingListJson) : [];
    if (!Array.isArray(liste)) liste = [];
  } catch (error) {
    liste = [];
  }
  if (liste.indexOf(sessionId) !== -1) {
    return { list: liste, changed: false };
  }
  return { list: liste.concat([sessionId]), changed: true };
}

const SHOP_LABELS = {
  hauptshop: 'Hauptshop',
  member: 'Member-Shop',
};

function formatGermanDate(dateStr) {
  const [year, month, day] = dateStr.split('-');
  return day + '.' + month + '.' + year;
}

const METRIC_ORDER = ['opens', 'clicks', 'cart'];

const METRIC_LABELS = {
  opens: 'Öffnungen',
  clicks: 'Klicks',
  cart: 'Warenkorb-Ereignisse',
};

const METRIC_SESSION_FIELDS = {
  opens: 'opensSessions',
  clicks: 'clicksSessions',
  cart: 'cartSessions',
};

export function buildReportEmail(input) {
  const dateStr = input.dateStr;
  const counts = input.counts;
  const germanDate = formatGermanDate(dateStr);
  const lines = SHOP_IDS.map(function (shop) {
    const shopCounts = counts[shop] || {};
    const parts = METRIC_ORDER.map(function (metric) {
      const value = shopCounts[metric] || 0;
      const sessionValue = shopCounts[METRIC_SESSION_FIELDS[metric]] || 0;
      return value + ' ' + METRIC_LABELS[metric] + ' (' + sessionValue + ' Sitzungen)';
    });
    return SHOP_LABELS[shop] + ': ' + parts.join(', ');
  });
  return {
    subject: 'Wizard-Nutzung ' + germanDate,
    text: lines.join('\n'),
  };
}
