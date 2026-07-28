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
