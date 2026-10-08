import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'GiftFill · 礼卡快填',
    description: '选择常用资料，一键准备美区 Apple Gift Card 订单，自动填写联系与账单信息，付款由你完成。',
    minimum_chrome_version: '116',
    permissions: ['storage', 'activeTab', 'sidePanel'],
    host_permissions: ['https://www.apple.com/shop/buy-giftcard/giftcard*', 'https://www.apple.com/shop/bag*', 'https://*.store.apple.com/shop/signIn*', 'https://*.store.apple.com/shop/checkout*'],
    action: { default_title: '打开礼卡快填' },
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'" },
  },
});
