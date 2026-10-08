import { browser } from 'wxt/browser';
import { parseProfile } from '../lib/profile';
import { fillPage, type FillResult } from '../lib/fill';
import { classifyPage } from '../lib/page';

export default defineContentScript({
  matches: ['https://www.apple.com/shop/buy-giftcard/giftcard*', 'https://*.store.apple.com/shop/checkout*'],
  runAt:'document_idle', allFrames:false,
  main() {
    let running=false;
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (sender.id!==browser.runtime.id) return false;
      if (message?.type==='GIFTFILL_STATUS') {
        sendResponse({page:classifyPage(location.href)}); return false;
      }
      if (message?.type!=='GIFTFILL_FILL') return false;
      const failure=(error:string):FillResult=>({page:classifyPage(location.href),fields:[],error});
      if (running) { sendResponse(failure('正在填写，请稍候')); return false; }
      let profile;
      try { profile=parseProfile(message.profile); } catch { sendResponse(failure('资料格式不正确，请重新保存')); return false; }
      running=true;
      void fillPage(profile,{overwrite:message.overwrite===true})
        .then(sendResponse)
        .catch(()=>sendResponse(failure('页面填写中断，请核对页面后重试')))
        .finally(()=>{running=false;});
      return true;
    });
  },
});
