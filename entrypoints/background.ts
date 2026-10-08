import { browser } from 'wxt/browser';

export default defineBackground(() => {
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick:true });
  // Profile storage belongs to extension pages. Content scripts receive only the
  // profile explicitly selected for one fill operation.
  void (async()=>{
    await browser.storage.local.setAccessLevel({ accessLevel:'TRUSTED_CONTEXTS' });
    await browser.storage.local.remove('giftfill.payment-vault.v1');
  })();
});
