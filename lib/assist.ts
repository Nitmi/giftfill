import { fillPage, billingFormReady, visible, until, type FillOptions, type FillResult } from './fill';
import { classifyPage, type PageKind } from './page';
import type { Profile } from './profile';

export interface AssistResult extends FillResult { status:'advanced'|'ready'|'blocked'; message:string }
export interface AssistOptions extends FillOptions { cancelled?:()=>boolean }
const clean=(text:string)=>text.trim().replace(/\s+/g,' ');
const money=(text:string)=>{const match=clean(text).match(/^\$([\d,]+(?:\.\d{2})?)$/);return match?Number(match[1]!.replace(/,/g,'')):NaN;};
function exactButton(doc:Document,label:string):HTMLButtonElement|null {
  // Deliberate allowlist: never accept a generic Continue, Pay, or Place Order.
  if(!['Add to Bag','Check Out','Continue as Guest'].includes(label))return null;
  return Array.from(doc.querySelectorAll<HTMLButtonElement>('button')).filter(visible).find(button=>!button.disabled&&clean(button.textContent??'')===label)??null;
}
export function verifyBag(doc:Document,profile:Profile):string|null {
  const items=Array.from(doc.querySelectorAll('[data-autom="bag-items"] > li'));
  if(items.length!==1)return '购物袋须只有一张电子礼品卡，请先检查数量和其他商品';
  const item=items[0]!;
  if(clean(item.querySelector('[data-autom="bag-item-name"]')?.textContent??'')!=='Apple Gift Card by Email')return '购物袋商品不是电子礼品卡，请手动检查';
  if(item.querySelector<HTMLSelectElement>('[data-autom="item-quantity-dropdown"]')?.value!=='1')return '礼品卡数量须为 1，已停止自动结账';
  if(money(item.querySelector('[data-autom="Monthly_price"]')?.textContent??'')!==Number(profile.amount)||money(doc.querySelector('[data-autom="bagtotalvalue"]')?.textContent??'')!==Number(profile.amount))return '购物袋金额与资料不一致，已停止自动结账';
  const rows=Array.from(item.querySelectorAll('.rs-iteminfo-egcdetails .rs-iteminfo-child-tagline'));
  for(const [label,name,email] of [['To:',profile.recipientName,profile.recipientEmail],['From:',profile.senderName,profile.senderEmail]]){
    const row=rows.find(row=>clean(row.querySelector('.rs-iteminfo-label')?.textContent??'')===label);
    const values=Array.from(row?.querySelectorAll('.rs-iteminfo-egcemail > span')??[]).map(span=>clean(span.textContent??''));
    if(!name||!email||values.length!==2||values[0]!==clean(name!)||values[1]?.toLowerCase()!==email!.trim().toLowerCase())return '购物袋收发件信息与资料不一致，请手动核对';
  }
  return null;
}
export async function assistPage(profile:Profile,options:AssistOptions,doc:Document=document,page:PageKind=classifyPage(location.href)):Promise<AssistResult> {
  const base={page,fields:[] as FillResult['fields']};
  const blocked=(message:string,fields=base.fields):AssistResult=>({...base,fields,status:'blocked',message,error:message});
  const cancelled=()=>options.cancelled?.()===true;
  if(cancelled())return blocked('快捷流程已停止');
  if(page==='giftcard'){
    if(![profile.recipientName,profile.recipientEmail,profile.senderName,profile.senderEmail].every(value=>value.trim()))return blocked('一键开始需要完整的收发件姓名和邮箱，请编辑资料补全');
    const result=await fillPage(profile,options,doc,page);
    if(result.error||result.fields.some(field=>field.status!=='filled'))return blocked(result.error??'填写结果需核对，已停止自动加入购物袋',result.fields);
    const button=await until(()=>exactButton(doc,'Add to Bag'),6000);
    if(!button)return blocked('苹果仍未启用 Add to Bag，请处理页面提示后重试',result.fields);
    if(cancelled())return blocked('快捷流程已停止',result.fields);
    // Recheck recipient, sender and price immediately before adding to the bag.
    const matches=[['toName',profile.recipientName],['toEmail',profile.recipientEmail],['fromName',profile.senderName],['fromEmail',profile.senderEmail]].every(([key,value])=>{
      const inputs=Array.from(doc.querySelectorAll<HTMLInputElement>('input')).filter(input=>visible(input)&&(input.name===key||input.getAttribute('data-autom')===key));
      return inputs.length===1&&clean(inputs[0]!.value)===clean(value!)&&inputs[0]!.getAttribute('aria-invalid')!=='true';
    });
    if(!matches||money(doc.querySelector('[data-autom="price-currentPrice"]')?.textContent??'')!==Number(profile.amount))return blocked('金额或收发件资料已变化，请核对后重试',result.fields);
    button.click();return {...result,status:'advanced',message:'已加入购物袋，等待页面跳转'};
  }
  if(page==='bag'){
    const problem=verifyBag(doc,profile);if(problem)return blocked(problem);
    const button=exactButton(doc,'Check Out');if(!button)return blocked('未找到可用的 Check Out 按钮，请在页面继续');
    if(cancelled())return blocked('快捷流程已停止');
    button.click();return {...base,status:'advanced',message:'已点击 Check Out，等待访客结账'};
  }
  if(page==='guest'){
    const button=exactButton(doc,'Continue as Guest');if(!button)return blocked('需要登录或额外验证，请自行处理页面');
    if(cancelled())return blocked('快捷流程已停止');
    button.click();return {...base,status:'advanced',message:'已选择访客结账，等待付款信息页'};
  }
  if(page==='checkout'){
    if(!billingFormReady(doc)){
      // Exact Apple credit-card control; no guessing other payment methods/steps.
      const credit=doc.getElementById('checkout.billing.billingoptions.credit') as HTMLInputElement|null;
      if(!credit||credit.type!=='radio'||credit.disabled||!visible(credit))return blocked('当前不是银行卡信息页，请在苹果页面继续操作');
      if(cancelled())return blocked('快捷流程已停止');
      if(!credit.checked)credit.click();
      const ready=await until(()=>billingFormReady(doc),8000);
      if(!ready)return blocked('账单表单尚未加载，请处理页面提示后再点「一键开始」');
    }
    const effective={...profile,contactEmail:profile.contactEmail||profile.senderEmail};
    const result=await fillPage(effective,options,doc,page);
    if(cancelled())return blocked('已停止；已经填入的资料会保留',result.fields);
    const message='联系与账单已填好。用浏览器或密码管理器填写银行卡，核对后自行完成购买。';
    return {...result,status:result.error?'blocked':'ready',message};
  }
  return blocked('页面不在美区礼品卡购买流程中，快捷流程已停止');
}
