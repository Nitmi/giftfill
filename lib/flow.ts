import type { PageKind } from './page';
import type { AssistResult } from './assist';

export interface FlowTarget { page:PageKind; ready:boolean }
export interface FlowHooks {
  read:()=>Promise<FlowTarget>;
  act:(page:PageKind)=>Promise<AssistResult>;
  update:(message:string)=>void;
  cancelled:()=>boolean;
  wait?:()=>Promise<void>;
  timeoutMs?:number;
}
const order:PageKind[]=['giftcard','bag','guest','checkout'];
export function validTransition(from:PageKind,to:PageKind):boolean {
  return (from==='giftcard'&&to==='bag')||(from==='bag'&&(to==='guest'||to==='checkout'))||(from==='guest'&&to==='checkout');
}
// The panel owns the run. Closing it stops future steps; no run is persisted.
export async function runFlow(hooks:FlowHooks):Promise<AssistResult> {
  const wait=hooks.wait??(()=>new Promise(resolve=>setTimeout(resolve,500)));
  const deadline=Date.now()+(hooks.timeoutMs??120000);
  let previous:PageKind|null=null;let latest:AssistResult|null=null;
  const failure=(message:string):AssistResult=>({page:previous??'unsupported',fields:latest?.fields??[],status:'blocked',message,error:message});
  while(Date.now()<deadline){
    if(hooks.cancelled())return failure('快捷流程已停止；已经填入的资料会保留');
    const target=await hooks.read();
    if(!target.ready){await wait();continue;}
    if(target.page==='unsupported')return failure('目标标签页离开了购买流程，已停止');
    if(target.page===previous){await wait();continue;}
    if(previous&&!validTransition(previous,target.page))return failure('页面返回了先前步骤或出现未知跳转，请核对后重新开始');
    if(!order.includes(target.page))return failure('当前页面不支持一键准备订单');
    previous=target.page;
    try {latest=await hooks.act(target.page);}
    catch {
      // Navigation can close the message channel after a click. Never retry a
      // potentially successful Add to Bag / Check Out on the same document.
      hooks.update('等待页面跳转；若没有跳转，流程将超时停止');await wait();continue;
    }
    hooks.update(latest.message);
    if(latest.status!=='advanced')return latest;
  }
  return failure('等待页面超时，请检查网络或页面提示。为避免重复加入购物袋，没有重试点击。');
}
