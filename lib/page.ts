export type PageKind = 'giftcard' | 'bag' | 'guest' | 'checkout' | 'unsupported';
export const APPLE_GIFTCARD_URL = 'https://www.apple.com/shop/buy-giftcard/giftcard';
export function classifyPage(url: string): PageKind {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return 'unsupported';
    if (parsed.hostname === 'www.apple.com' && /^\/shop\/buy-giftcard\/giftcard(?:\/|$)/.test(parsed.pathname)) return 'giftcard';
    if (parsed.hostname === 'www.apple.com' && /^\/shop\/bag\/?$/.test(parsed.pathname)) return 'bag';
    if (parsed.hostname.endsWith('.store.apple.com') && /^\/shop\/signIn\/?$/.test(parsed.pathname)) return 'guest';
    if (parsed.hostname.endsWith('.store.apple.com') && /^\/shop\/checkout(?:\/|$)/.test(parsed.pathname)) return 'checkout';
  } catch { /* Browser-internal pages and malformed URLs are unsupported. */ }
  return 'unsupported';
}
