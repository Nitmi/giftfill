import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'GiftFill · 礼卡快填',
    description: '保存多份常用资料，一键填写美区 Apple Gift Card 的金额、收发件信息与账单地址。',
    minimum_chrome_version: '116',
    permissions: ['storage', 'activeTab', 'sidePanel'],
    host_permissions: ['https://www.apple.com/shop/buy-giftcard/giftcard*', 'https://*.store.apple.com/shop/checkout*'],
    action: { default_title: '打开礼卡快填' },
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'" },
  },
});
