const SHOP_ORIGINS = {
  'https://www.biohairbeauty.shop': 'hauptshop',
  'https://member.biohairbeauty.shop': 'member',
};

export const SHOP_IDS = ['hauptshop', 'member'];

export function resolveShopFromOrigin(origin) {
  if (!origin) {
    return null;
  }
  return SHOP_ORIGINS[origin] || null;
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

export function kvKeyForShopDate(shop, dateStr) {
  return 'count:' + shop + ':' + dateStr;
}

const SHOP_LABELS = {
  hauptshop: 'Hauptshop',
  member: 'Member-Shop',
};

function formatGermanDate(dateStr) {
  const [year, month, day] = dateStr.split('-');
  return day + '.' + month + '.' + year;
}

export function buildReportEmail(input) {
  const dateStr = input.dateStr;
  const counts = input.counts;
  const germanDate = formatGermanDate(dateStr);
  const lines = SHOP_IDS.map(function (shop) {
    const count = counts[shop] || 0;
    return SHOP_LABELS[shop] + ': ' + count + ' Öffnungen';
  });
  return {
    subject: 'Wizard-Nutzung ' + germanDate,
    text: lines.join('\n'),
  };
}
