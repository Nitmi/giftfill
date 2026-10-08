import { browser } from 'wxt/browser';
import { parseProfile } from '../lib/profile';
import { classifyPage } from '../lib/page';
import { assistPage } from '../lib/assist';

export default defineContentScript({
  matches: ['https://www.apple.com/shop/buy-giftcard/giftcard*', 'https://www.apple.com/shop/bag*', 'https://*.store.apple.com/shop/signIn*', 'https://*.store.apple.com/shop/checkout*'],
  runAt:'document_idle', allFrames:false,
  main() {
    let running=false;
    let generation=0;
    const runs=new Set<string>();
    browser.runtime.onConnect.addListener(port=>{
      if(port.sender?.id!==browser.runtime.id||port.name!=='giftfill-run')return;
      port.onDisconnect.addListener(()=>{generation++;});
    });
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (sender.id!==browser.runtime.id) return false;
      if (message?.type==='GIFTFILL_STATUS') {
        sendResponse({page:classifyPage(location.href)}); return false;
      }
      if(message?.type==='GIFTFILL_STOP'){generation++;sendResponse({stopped:true});return false;}
      if (message?.type!=='GIFTFILL_ASSIST') return false;
      const failure=(error:string)=>({page:classifyPage(location.href),fields:[],error,status:'blocked' as const,message:error});
      if (running) { sendResponse(failure('正在填写，请稍候')); return false; }
      let profile;
      try { profile=parseProfile(message.profile); } catch { sendResponse(failure('资料格式不正确，请重新保存')); return false; }
      if(message.expectedPage!==classifyPage(location.href)){sendResponse(failure('页面已变化，请重新开始'));return false;}
      if(typeof message.runId!=='string'||!/^[-\w]{1,80}$/.test(message.runId)||runs.has(message.runId)){sendResponse(failure('该页面步骤已经执行，请检查页面'));return false;}
      runs.add(message.runId);
      const current=generation;running=true;
      void assistPage(profile,{overwrite:true,cancelled:()=>current!==generation})
        .then(sendResponse).catch(()=>sendResponse(failure('页面操作中断，请核对后重试'))).finally(()=>{running=false;});
      return true;
    });
  },
});
