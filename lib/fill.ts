import type { Profile } from './profile';
import { classifyPage, type PageKind } from './page';

type FormElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
export interface FieldResult { key: string; label: string; status: 'filled' | 'preserved' | 'missing' | 'failed'; detail?: string }
export interface FillResult { page: PageKind; fields: FieldResult[]; error?: string }
export interface FillOptions { overwrite: boolean; timeoutMs?: number }
interface Rule { key: keyof Profile; label: string; names: string[]; autocomplete?: string; labels?: string[] }
export const COUNTRIES: Record<string, string> = {
  US: 'United States', CN: 'China', HK: 'Hong Kong', JP: 'Japan', CA: 'Canada', GB: 'United Kingdom',
  AU: 'Australia', SG: 'Singapore', TW: 'Taiwan', DE: 'Germany', FR: 'France',
};
const STATES: Record<string, string> = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California', CO:'Colorado', CT:'Connecticut',
  DE:'Delaware', DC:'District of Columbia', FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois',
  IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland', MA:'Massachusetts',
  MI:'Michigan', MN:'Minnesota', MS:'Mississippi', MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada',
  NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota',
  OH:'Ohio', OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina',
  SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont', VA:'Virginia', WA:'Washington',
  WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming', PR:'Puerto Rico', GU:'Guam', VI:'Virgin Islands',
};
const GIFT_RULES: Rule[] = [
  { key:'recipientName', label:'收件人姓名', names:['toName','recipientName'], labels:['Recipient Name'] },
  { key:'recipientEmail', label:'收件人邮箱', names:['toEmail','recipientEmail'], labels:['Recipient Email Address','Recipient Email'] },
  { key:'senderName', label:'发件人姓名', names:['fromName','senderName'], labels:['Sender Name'] },
  { key:'senderEmail', label:'发件人邮箱', names:['fromEmail','senderEmail'], labels:['Sender Email Address','Sender Email'] },
];
const BILLING_RULES: Rule[] = [
  { key:'firstName', label:'账单名字', names:['firstName'], autocomplete:'given-name', labels:['First Name'] },
  { key:'lastName', label:'账单姓氏', names:['lastName'], autocomplete:'family-name', labels:['Last Name'] },
  { key:'postalCode', label:'邮编 / ZIP', names:['postalCode','zipCode','zip'], autocomplete:'postal-code', labels:['ZIP Code','Postal Code','ZIP'] },
  { key:'street', label:'街道地址', names:['street','address1','addressLine1'], autocomplete:'address-line1', labels:['Street Address','Address Line 1'] },
  { key:'street2', label:'公寓 / 门牌', names:['street2','address2','addressLine2'], autocomplete:'address-line2', labels:['Apt, Suite, Bldg. (optional)','Apt, Suite, Bldg','Address Line 2'] },
  { key:'city', label:'城市', names:['city'], autocomplete:'address-level2', labels:['City','City / Town'] },
  { key:'state', label:'州 / 省', names:['state','province'], autocomplete:'address-level1', labels:['State','Province'] },
  { key:'district', label:'区 / 县', names:['district'], autocomplete:'address-level3', labels:['District'] },
  { key:'phone', label:'联系电话', names:['fullDaytimePhone','phoneNumber','phone'], autocomplete:'tel', labels:['Phone Number','Mobile Phone Number'] },
  { key:'contactEmail', label:'订单联系邮箱', names:['emailAddress','contactEmail'], autocomplete:'email', labels:['Email Address','Contact Email'] },
];
const COUNTRY_RULE: Rule = { key:'billingCountry', label:'账单国家 / 地区', names:['countryCode','country','billingCountry'], autocomplete:'country', labels:['Country/Region','Country / Region','Country'] };

function normalized(text: string): string { return text.trim().replace(/\s+/g,' ').toLowerCase(); }
function visible(element: Element): boolean {
  const el = element as HTMLElement;
  if (el.closest('[hidden], [aria-hidden="true"]')) return false;
  const style = el.ownerDocument.defaultView!.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
}
function editable(el: FormElement): boolean { return visible(el) && !el.matches(':disabled') && !('readOnly' in el && el.readOnly); }
function labelsFor(el: Element): string[] {
  const input = el as HTMLInputElement;
  const labels = Array.from(input.labels ?? []).map(label => label.textContent ?? '');
  const aria = el.getAttribute('aria-label');
  if (aria) labels.push(aria);
  for (const id of (el.getAttribute('aria-labelledby') ?? '').split(/\s+/)) {
    const text = el.ownerDocument.getElementById(id)?.textContent;
    if (text) labels.push(text);
  }
  const placeholder = el.getAttribute('placeholder');
  if (placeholder) labels.push(placeholder);
  return labels.map(normalized);
}
function nameMatches(name: string, target: string): boolean {
  return name === target || name.endsWith('.'+target) || name.endsWith('_'+target);
}
function findField(doc: Document, rule: Rule, includeUnavailable = false): FormElement | null {
  const candidates = Array.from(doc.querySelectorAll<FormElement>('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="password"]), textarea, select')).filter(includeUnavailable ? visible : editable);
  const strategies = [
    (el: FormElement) => rule.names.some(name => nameMatches(el.name, name)),
    (el: FormElement) => rule.names.includes(el.getAttribute('data-autom') ?? ''),
    (el: FormElement) => !!rule.autocomplete && (el.autocomplete ?? '').split(/\s+/).includes(rule.autocomplete),
    (el: FormElement) => !!rule.labels?.some(label => labelsFor(el).includes(normalized(label))),
  ];
  for (const match of strategies) {
    const matches = candidates.filter(match);
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) return null; // Ambiguous fields require a manual choice.
  }
  return null;
}
async function changeValue(el: FormElement, value: string, commitAmount = false): Promise<void> {
  const view = el.ownerDocument.defaultView!;
  const prototype = el.tagName === 'SELECT' ? view.HTMLSelectElement.prototype
    : el.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
  el.focus();
  // Apple uses focus and input to update React state. Blurring in the same
  // JavaScript task submits the previous render's value, especially for amount.
  await new Promise(resolve => setTimeout(resolve, 80));
  if (!el.isConnected) return;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new view.InputEvent('input', { bubbles:true, composed:true, inputType:'insertText', data:value }));
  el.dispatchEvent(new view.Event('change', { bubbles:true, composed:true }));
  if (commitAmount) {
    // Apple starts its debounced price formatter from keydown, not input/change.
    // A navigation key invokes that handler without inserting text or submitting.
    el.dispatchEvent(new view.KeyboardEvent('keydown', {bubbles:true,composed:true,cancelable:true,key:'End',code:'End',keyCode:35,which:35}));
    el.dispatchEvent(new view.KeyboardEvent('keyup', {bubbles:true,composed:true,key:'End',code:'End',keyCode:35,which:35}));
    await new Promise(resolve => setTimeout(resolve, 300));
  } else await new Promise(resolve => setTimeout(resolve, 80));
  if (!el.isConnected) return;
  el.blur();
}
async function until<T>(read: () => T | null | false, timeout: number): Promise<T | null> {
  const end = Date.now() + timeout;
  do {
    const value = read();
    if (value !== null && value !== false) return value;
    await new Promise(resolve => setTimeout(resolve, 80));
  } while (Date.now() < end);
  return null;
}
function aliases(value: string, key?: keyof Profile): string[] {
  if (key === 'billingCountry') return [value, COUNTRIES[value] ?? value, ...(value === 'CN' ? ['China mainland','Mainland China'] : []), ...(value === 'HK' ? ['Hong Kong SAR China'] : [])].map(normalized);
  if (key === 'state') {
    const code = value.toUpperCase();
    const entry = Object.entries(STATES).find(([, name]) => normalized(name) === normalized(value));
    return [value, STATES[code] ?? value, entry?.[0] ?? value].map(normalized);
  }
  return [normalized(value)];
}
function elementMatchesValue(el: FormElement, value: string, key?: keyof Profile): boolean {
  if (key === 'phone') {
    const digits = value.replace(/\D/g, '');
    const actual = el.value.replace(/\D/g, '');
    return !!digits && actual === digits;
  }
  const accepted = aliases(value, key);
  if (el.tagName === 'SELECT') {
    const select = el as HTMLSelectElement;
    const option = select.selectedOptions[0];
    return !!option && (accepted.includes(normalized(option.value)) || accepted.includes(normalized(option.textContent ?? '')));
  }
  return accepted.includes(normalized(el.value));
}
function cityStateMatches(text:string, profile:Profile):boolean {
  const cleaned=normalized(text).replace(/[,]/g,' ').replace(/\s+/g,' ');
  return aliases(profile.state,'state').some(state=>cleaned===normalized(profile.city+' '+state));
}
async function fillCombinedCityState(doc:Document, profile:Profile, overwrite:boolean, timeout:number):Promise<FieldResult[]|null> {
  if(!profile.city||!profile.state)return null;
  const rule:Rule={key:'city',label:'城市与州',names:['zipLookupCityState'],labels:['City, State','City, State / Province','City / State']};
  const el=findField(doc,rule);if(!el)return null;
  const outcomes=(status:FieldResult['status'],detail?:string):FieldResult[]=>[
    {key:'city',label:'城市',status,detail},{key:'state',label:'州 / 省',status,detail},
  ];
  const current=el.tagName==='SELECT'?(el as HTMLSelectElement).selectedOptions[0]?.textContent??'':el.value;
  if(cityStateMatches(current,profile))return outcomes('filled');
  if(!overwrite&&el.value.trim())return outcomes('preserved','保留页面已有的城市与州');
  if(el.tagName==='SELECT'){
    const option=Array.from((el as HTMLSelectElement).options).find(opt=>!opt.disabled&&cityStateMatches(opt.textContent??'',profile));
    if(option){await changeValue(el,option.value);return outcomes('filled');}
  }else if(el.getAttribute('role')==='combobox'){
    el.focus();el.click();
    const option=await until(()=>{
      const listId=el.getAttribute('aria-controls')??(el.id?el.id+'_listbox':'');
      const scope=(listId?doc.getElementById(listId):null)??Array.from(doc.querySelectorAll('[role="listbox"]')).find(visible);
      return scope?Array.from(scope.querySelectorAll<HTMLElement>('[role="option"]')).filter(visible).find(item=>cityStateMatches(item.textContent??'',profile))??null:null;
    },timeout);
    if(option){option.click();return outcomes('filled');}
  }
  return outcomes('failed','请在 ZIP 对应的城市与州列表中手动选择');
}
async function assign(el: FormElement, value: string, key: keyof Profile, timeout: number): Promise<boolean> {
  const accepted = aliases(value,key);
  if (el.tagName === 'SELECT') {
    const option = Array.from((el as HTMLSelectElement).options).find(opt => !opt.disabled && (accepted.includes(normalized(opt.value)) || accepted.includes(normalized(opt.textContent ?? ''))));
    if (!option) return false;
    await changeValue(el, option.value);
    return true;
  }
  if (el.getAttribute('role') === 'combobox') {
    if (elementMatchesValue(el,value,key)) return true;
    const originalValue=el.value;
    await changeValue(el, '');
    el.focus(); el.click();
    const target = await until(() => {
      const listId = el.getAttribute('aria-controls') ?? (el.id ? el.id+'_listbox' : '');
      const scope = (listId ? el.ownerDocument.getElementById(listId) : null)
        ?? Array.from(el.ownerDocument.querySelectorAll('[role="listbox"]')).find(visible);
      if (!scope) return null;
      return Array.from(scope.querySelectorAll<HTMLElement>('[role="option"]')).filter(visible)
        .find(option => accepted.includes(normalized(option.textContent ?? '')) || accepted.includes(normalized(option.getAttribute('data-value') ?? ''))) ?? null;
    },timeout);
    if (!target) { await changeValue(el,originalValue); return false; }
    target.click();
    return true;
  }
  await changeValue(el,value);
  return true;
}

async function selectRadio(doc: Document, names: string[], values: string[], timeout: number): Promise<boolean> {
  const wanted = values.map(normalized);
  const radio = await until(() => Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
    .filter(el => visible(el) && !el.matches(':disabled') && names.some(name => nameMatches(el.name,name)))
    .find(el => wanted.includes(normalized(el.value)) || labelsFor(el).some(label => wanted.includes(label))) ?? null,timeout);
  if (!radio) return false;
  if (!radio.checked) radio.click();
  return !!await until(() => {
    const current = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      .find(el => names.some(name => nameMatches(el.name,name)) && el.checked && (wanted.includes(normalized(el.value)) || labelsFor(el).some(label=>wanted.includes(label))));
    return current ?? null;
  },timeout);
}

async function fillAmount(doc: Document, amount: string, timeout: number): Promise<FieldResult> {
  const result: FieldResult = { key:'amount', label:'礼品卡金额', status:'failed' };
  const number = Number(amount);
  const presets = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="radio"][name="giftcard-amount"]'));
  const preset = presets.find(el => labelsFor(el).some(label => Number(label.replace(/[$,\s]/g,'')) === number));
  if (preset) {
    const label = labelsFor(preset)[0] ?? preset.value;
    if (await selectRadio(doc,['giftcard-amount'],[label,preset.value],timeout)) result.status='filled';
    return result;
  }
  if (!await selectRadio(doc,['giftcard-amount'],['Other Amount','other','custom'],timeout)) {
    result.detail='未找到自定义金额选项'; return result;
  }
  const rule: Rule = { key:'amount', label:'礼品卡金额', names:['customAmount','otherAmount','giftCardAmount'], labels:['Other Amount','Amount'], autocomplete:undefined };
  const input = await until(()=>findField(doc,rule),timeout);
  if (!input) { result.detail='未找到自定义金额输入框'; return result; }
  await changeValue(input,amount,true);
  await new Promise(resolve=>setTimeout(resolve,160));
  // Some Apple variants commit the custom amount by replacing the current form.
  const committed = await until(()=> {
    const current = findField(doc,rule);
    // Blur renders the formatter's confirmed amount. Revisit it while the
    // response is pending, so a previous valid amount cannot count as success.
    if (current) {
      current.focus();
      current.blur();
      if (Number(current.value) === number && current.validity.valid && current.getAttribute('aria-invalid') !== 'true') return true;
    }
    const checked = doc.querySelector<HTMLInputElement>('input[name="giftcard-amount"]:checked');
    if (checked && (Number(checked.value) === number || labelsFor(checked).some(label=>Number(label.replace(/[$,\s]/g,''))===number))) return true;
    const title = doc.querySelector('h1')?.textContent ?? '';
    return title.includes('$'+amount) ? true : null;
  },timeout);
  result.status = committed ? 'filled' : 'failed';
  if (!committed) result.detail='页面没有保留金额，请核对自定义金额';
  return result;
}

export async function fillPage(profile: Profile, options: FillOptions, doc: Document = document, pageOverride?: PageKind): Promise<FillResult> {
  const phoneDigits = profile.phone.replace(/\D/g, '');
  if (profile.billingCountry === 'US' && phoneDigits.length === 11 && phoneDigits.startsWith('1')) {
    // Apple's US phone field limits input to ten digits before it formats the value.
    profile = { ...profile, phone: phoneDigits.slice(1) };
  }
  const page = pageOverride ?? classifyPage(doc.location.href);
  const result: FillResult = { page, fields:[] };
  if (page === 'unsupported') { result.error='请在美区礼品卡商品页或 Apple 结账页使用'; return result; }
  const timeout = options.timeoutMs ?? 4500;
  let activeRules: Rule[];
  if (page === 'giftcard') {
    const emailSelected = await selectRadio(doc,['dimensionGiftCardType','giftCardType'],['Email'],timeout);
    result.fields.push({ key:'delivery', label:'Email 发送方式', status:emailSelected?'filled':'missing' });
    if (!emailSelected) return result;
    result.fields.push(await fillAmount(doc,profile.amount,timeout));
    if (result.fields.at(-1)?.status !== 'filled') return result;
    activeRules=GIFT_RULES;
    const ready = await until(() => GIFT_RULES.every(rule => findField(doc, rule)) ? true : null, options.timeoutMs ?? 8000);
    if (!ready) {
      const amount = result.fields.find(field => field.key === 'amount')!;
      const blocked = GIFT_RULES.some(rule => {
        const el = findField(doc, rule, true);
        return el && !editable(el);
      });
      if (blocked) {
        amount.status = 'failed';
        amount.detail = '苹果尚未确认金额，收发件输入框仍被禁用；请在金额框确认后重试';
      }
      for (const rule of GIFT_RULES.filter(rule => profile[rule.key])) {
        const el = findField(doc, rule, true);
        result.fields.push({key:rule.key,label:rule.label,status:el?'failed':'missing',detail:el?'输入框尚未启用，等待苹果确认金额':'未识别此字段'});
      }
      return result;
    }
  } else {
    const existingAddress = findField(doc,COUNTRY_RULE) || findField(doc,BILLING_RULES[0]!);
    if (!existingAddress) {
      result.error='请先展开账单地址或选择你的支付方式，再点填写'; return result;
    }
    const country = await until(()=>findField(doc,COUNTRY_RULE),timeout);
    if (country) {
      const matches = elementMatchesValue(country,profile.billingCountry,'billingCountry');
      const changed = !matches && await assign(country,profile.billingCountry,'billingCountry',timeout);
      const valid = matches || (changed && !!await until(()=> {
        const current=findField(doc,COUNTRY_RULE);
        return current && elementMatchesValue(current,profile.billingCountry,'billingCountry') ? true:null;
      },timeout));
      result.fields.push({ key:'billingCountry',label:'账单国家 / 地区',status:valid?'filled':'failed' });
      if (!valid) return result;
      if (changed) await new Promise(resolve=>setTimeout(resolve,300));
    } else result.fields.push({key:'billingCountry',label:'账单国家 / 地区',status:'missing'});
    activeRules=BILLING_RULES;
  }
  const candidates = activeRules.filter(rule=>profile[rule.key]);
  const previous = new Map<string,string>();
  const preserved = new Set<string>();
  for (const rule of candidates) {
    if((rule.key==='city'||rule.key==='state')&&result.fields.some(field=>field.key===rule.key))continue;
    const el=await until(()=>findField(doc,rule), timeout);
    if (!el) {
      const combined=(rule.key==='city'||rule.key==='state')?await fillCombinedCityState(doc,profile,options.overwrite,Math.min(timeout,1500)):null;
      if(combined){result.fields.push(...combined);continue;}
      result.fields.push({key:rule.key,label:rule.label,status:'missing'});continue;
    }
    previous.set(rule.key,el.value);
    if (!options.overwrite && el.value.trim() && !elementMatchesValue(el,profile[rule.key],rule.key)) {
      preserved.add(rule.key);
      result.fields.push({key:rule.key,label:rule.label,status:'preserved',detail:'保留页面已有内容'}); continue;
    }
    const assigned=await assign(el,profile[rule.key],rule.key,Math.min(timeout,1500));
    result.fields.push({key:rule.key,label:rule.label,status:assigned?'filled':'failed',detail:assigned?undefined:'该选项需要手动选择'});
    if (rule.key==='postalCode') await new Promise(resolve=>setTimeout(resolve,180));
  }
  // Verify after country/ZIP-driven rerenders; never label an attempted write as success.
  for (let pass=0;pass<3;pass++) {
    await new Promise(resolve=>setTimeout(resolve,180));
    for (const rule of candidates) {
      if (preserved.has(rule.key)) continue;
      const item=result.fields.find(field=>field.key===rule.key)!;
      const el=findField(doc,rule);
      if (!el) {
        if(rule.key==='city'||rule.key==='state'){
          const combined=await fillCombinedCityState(doc,profile,options.overwrite,Math.min(timeout,1000));
          const outcome=combined?.find(field=>field.key===rule.key);
          if(outcome){Object.assign(item,outcome);continue;}
        }
        item.status='missing';continue;
      }
      if (elementMatchesValue(el,profile[rule.key],rule.key)) { item.status='filled'; delete item.detail; continue; }
      if (!options.overwrite && el.value.trim() && el.value!==previous.get(rule.key)) {
        item.status='preserved'; item.detail='页面已更新此字段，请核对'; preserved.add(rule.key); continue;
      }
      if (pass<2) await assign(el,profile[rule.key],rule.key,Math.min(timeout,1000));
      else { item.status='failed'; item.detail='页面未保留填写结果，请手动核对'; }
    }
  }
  for(const rule of candidates){
    const item=result.fields.find(field=>field.key===rule.key)!;
    if(item.status!=='filled')continue;
    const valid=await until(()=>{
      const el=findField(doc,rule);
      if(!el)return (rule.key==='city'||rule.key==='state')?true:null;
      return elementMatchesValue(el,profile[rule.key],rule.key)&&el.validity.valid&&el.getAttribute('aria-invalid')!=='true'?true:null;
    },Math.min(timeout,1800));
    if(!valid){item.status='failed';item.detail='页面校验未通过，请检查此字段';}
  }
  return result;
}
