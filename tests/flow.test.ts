import { describe,it,expect,vi } from 'vitest';
import { runFlow,validTransition } from '../lib/flow';
import type { PageKind } from '../lib/page';
import type { AssistResult } from '../lib/assist';
describe('assisted navigation boundaries',()=>{
  it('advances only through bag and guest to checkout, each page once',async()=>{
    const pages:PageKind[]=['giftcard','bag','guest','checkout'];let index=0;
    const act=vi.fn(async(page:PageKind):Promise<AssistResult>=>{index++;return {page,fields:[],status:page==='checkout'?'ready':'advanced',message:page};});
    const result=await runFlow({read:async()=>({page:pages[index]!,ready:true}),act,update:()=>{},cancelled:()=>false});
    expect(act.mock.calls.map(call=>call[0])).toEqual(pages);expect(result.status).toBe('ready');
    expect(validTransition('bag','checkout')).toBe(true);expect(validTransition('checkout','bag')).toBe(false);
  });
  it('does not retry a click when navigation loses the response',async()=>{
    let reads=0;
    const act=vi.fn(async(page:PageKind):Promise<AssistResult>=>{if(page==='giftcard')throw new Error('channel disconnected');return {page,fields:[],status:'ready',message:'stop'};});
    await runFlow({read:async()=>({page:++reads<4?'giftcard':'bag',ready:true}),act,update:()=>{},cancelled:()=>false,wait:async()=>{}});
    expect(act.mock.calls.map(call=>call[0])).toEqual(['giftcard','bag']);
  });
  it('stops after cancellation or an unexpected backward navigation',async()=>{
    let cancelled=false;
    const act=vi.fn(async(page:PageKind):Promise<AssistResult>=>{cancelled=true;return {page,fields:[],status:'advanced',message:'done'};});
    const result=await runFlow({read:async()=>({page:'giftcard',ready:true}),act,update:()=>{},cancelled:()=>cancelled});
    expect(result.error).toContain('停止');expect(act).toHaveBeenCalledOnce();
    let i=0;const steps:PageKind[]=['bag','giftcard'];
    const backwards=await runFlow({read:async()=>({page:steps[i++]!,ready:true}),act:async page=>({page,fields:[],status:'advanced',message:'done'}),update:()=>{},cancelled:()=>false});
    expect(backwards.error).toContain('先前步骤');
  });
});
