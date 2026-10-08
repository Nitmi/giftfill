import { fillPage, changeValue, visible, until, type FillOptions, type FillResult } from './fill';
import { classifyPage, type PageKind } from './page';
import type { Profile } from './profile';
import { parseCard, type PaymentCard } from './vault';

export interface AssistResult extends FillResult { status:'advanced'|'ready'|'blocked'; message:string }
export interface AssistOptions extends FillOptions { navigate:boolean; card?:PaymentCard; cancelled?:()=>boolean }
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
function cardInput(doc:Document,token:string):HTMLInputElement|null {
  const inputs=Array.from(doc.querySelectorAll<HTMLInputElement>('input')).filter(input=>visible(input)&&!input.disabled&&!input.readOnly&&(input.autocomplete??'').split(/\s+/).includes(token));
  return inputs.length===1?inputs[0]!:null;
}
export async function fillPayment(card:PaymentCard,doc:Document):Promise<FillResult['fields']> {
  const parsed=parseCard(card);const number=cardInput(doc,'cc-number');const expiry=cardInput(doc,'cc-exp');
  if(!number||!expiry)return [{key:'payment',label:'银行卡',status:'missing',detail:'未找到唯一可填写的卡号与有效期框，请使用浏览器填充'}];
  const digits=(value:string)=>value.replace(/\D/g,'');
  if(number.value.trim()&&digits(number.value)!==parsed.number)return [{key:'payment',label:'银行卡',status:'preserved',detail:'页面已有其他卡片，请先清空卡号或自行核对'}];
  await changeValue(number,parsed.number);
  const currentExpiry=cardInput(doc,'cc-exp');
  if(currentExpiry)await changeValue(currentExpiry,parsed.expiry);
  await new Promise(resolve=>setTimeout(resolve,400));
  return [
    {key:'cardNumber',label:`银行卡 · •••• ${parsed.number.slice(-4)}`,status:cardInput(doc,'cc-number')&&digits(cardInput(doc,'cc-number')!.value)===parsed.number&&cardInput(doc,'cc-number')!.validity.valid&&cardInput(doc,'cc-number')!.getAttribute('aria-invalid')!=='true'?'filled':'failed'},
    {key:'cardExpiry',label:'银行卡有效期',status:cardInput(doc,'cc-exp')&&digits(cardInput(doc,'cc-exp')!.value)===digits(parsed.expiry)&&cardInput(doc,'cc-exp')!.validity.valid&&cardInput(doc,'cc-exp')!.getAttribute('aria-invalid')!=='true'?'filled':'failed'},
    {key:'cvv',label:'CVV 安全码',status:'preserved',detail:'请在苹果页面输入；插件不保存、不读取此项'},
  ];
}
export async function assistPage(profile:Profile,options:AssistOptions,doc:Document=document,page:PageKind=classifyPage(location.href)):Promise<AssistResult> {
  const base={page,fields:[] as FillResult['fields']};
  const blocked=(message:string,fields=base.fields):AssistResult=>({...base,fields,status:'blocked',message,error:message});
  const cancelled=()=>options.cancelled?.()===true;
  if(cancelled())return blocked('快捷流程已停止');
  if(page==='giftcard'){
    if(!options.navigate)return {...await fillPage(profile,options,doc,page),status:'ready',message:'礼品卡资料已填写'};
    if(![profile.recipientName,profile.recipientEmail,profile.senderName,profile.senderEmail].every(value=>value.trim()))return blocked('快捷结账需要完整的收发件姓名和邮箱，请编辑资料补全');
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
    if(!options.navigate)return blocked('请使用「快捷结账」检查购物袋并继续');
    const problem=verifyBag(doc,profile);if(problem)return blocked(problem);
    const button=exactButton(doc,'Check Out');if(!button)return blocked('未找到可用的 Check Out 按钮，请在页面继续');
    if(cancelled())return blocked('快捷流程已停止');
    button.click();return {...base,status:'advanced',message:'已点击 Check Out，等待访客结账'};
  }
  if(page==='guest'){
    if(!options.navigate)return blocked('请使用「快捷结账」以访客继续');
    const button=exactButton(doc,'Continue as Guest');if(!button)return blocked('需要登录或额外验证，请自行处理页面');
    if(cancelled())return blocked('快捷流程已停止');
    button.click();return {...base,status:'advanced',message:'已选择访客结账，等待付款信息页'};
  }
  if(page==='checkout'){
    let number=cardInput(doc,'cc-number');
    if(!number){
      // Exact Apple credit-card control; no guessing other payment methods/steps.
      const credit=doc.getElementById('checkout.billing.billingoptions.credit') as HTMLInputElement|null;
      if(!credit||credit.type!=='radio'||credit.disabled||!visible(credit))return blocked('当前不是银行卡信息页，请在苹果页面继续操作');
      if(cancelled())return blocked('快捷流程已停止');
      credit.click();number=await until(()=>cardInput(doc,'cc-number'),8000);
      if(!number)return blocked('银行卡表单尚未加载，或使用独立支付框，请在页面手动处理');
    }
    const effective={...profile,contactEmail:profile.contactEmail||profile.senderEmail};
    const result=await fillPage(effective,options,doc,page);
    if(cancelled())return blocked('已停止；已经填入的资料会保留',result.fields);
    if(options.card){try{result.fields.push(...await fillPayment(options.card,doc));}catch{result.fields.push({key:'payment',label:'银行卡',status:'failed',detail:'卡片已过期或格式无效，请重新保存'});}}
    const message=options.card?'联系与付款资料已填写。请核对页面、输入 CVV 并手动继续。':'联系与账单资料已填写。银行卡可用浏览器填充，或解锁卡库后点击「填写此页」。';
    return {...result,status:result.error?'blocked':'ready',message};
  }
  return blocked('页面不在美区礼品卡购买流程中，快捷流程已停止');
}
