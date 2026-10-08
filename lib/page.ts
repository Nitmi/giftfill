export type PageKind = 'giftcard' | 'checkout' | 'unsupported';
export const APPLE_GIFTCARD_URL = 'https://www.apple.com/shop/buy-giftcard/giftcard';
export function classifyPage(url: string): PageKind {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return 'unsupported';
    if (parsed.hostname === 'www.apple.com' && /^\/shop\/buy-giftcard\/giftcard(?:\/|$)/.test(parsed.pathname)) return 'giftcard';
    if (parsed.hostname.endsWith('.store.apple.com') && /^\/shop\/checkout(?:\/|$)/.test(parsed.pathname)) return 'checkout';
  } catch { /* Browser-internal pages and malformed URLs are unsupported. */ }
  return 'unsupported';
}
