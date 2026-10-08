import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'GiftFill · 礼卡快填',
    description: '美区 Apple Gift Card 常用资料、加密付款卡库与访客快捷结账，在付款确认前停止。',
    minimum_chrome_version: '116',
    permissions: ['storage', 'activeTab', 'sidePanel'],
    host_permissions: ['https://www.apple.com/shop/buy-giftcard/giftcard*', 'https://www.apple.com/shop/bag*', 'https://*.store.apple.com/shop/signIn*', 'https://*.store.apple.com/shop/checkout*'],
    action: { default_title: '打开礼卡快填' },
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'" },
  },
});
