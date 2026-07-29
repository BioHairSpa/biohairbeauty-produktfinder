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

export function buildReportEmail(input) {
  const dateStr = input.dateStr;
  const counts = input.counts;
  const germanDate = formatGermanDate(dateStr);
  const lines = SHOP_IDS.map(function (shop) {
    const shopCounts = counts[shop] || {};
    const parts = METRIC_ORDER.map(function (metric) {
      const value = shopCounts[metric] || 0;
      return value + ' ' + METRIC_LABELS[metric];
    });
    return SHOP_LABELS[shop] + ': ' + parts.join(', ');
  });
  return {
    subject: 'Wizard-Nutzung ' + germanDate,
    text: lines.join('\n'),
  };
}
