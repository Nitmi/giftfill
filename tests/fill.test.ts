import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fillPage } from '../lib/fill';
import { newProfile } from '../lib/profile';

beforeEach(()=>{
  vi.spyOn(Element.prototype,'getClientRects').mockImplementation(function(this:Element){
    return (this.closest('[hidden]')?[]:[new DOMRect(0,0,100,30)]) as unknown as DOMRectList;
  });
});
afterEach(()=>{vi.restoreAllMocks();document.body.replaceChildren();});
const input=(name:string)=>document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
const profile=()=>({...newProfile(),name:'Test',amount:'20',recipientName:'Example Recipient',recipientEmail:'recipient@example.com',senderName:'Example Sender',senderEmail:'sender@example.com',firstName:'Example',lastName:'User',street:'1 Example Street',city:'Cupertino',state:'CA',postalCode:'95014',phone:'+1 202 555 0100',contactEmail:'contact@example.com'});
function giftFixture() {
  document.body.innerHTML=`<label><input type="radio" name="dimensionGiftCardType" value="email">Email</label>
    <label><input type="radio" name="giftcard-amount" value="25" disabled>$25</label>
    <label><input type="radio" name="giftcard-amount" value="other" disabled>Other Amount</label>
    <label>Other Amount<input id="dynamic-other" disabled></label>
    <label>Recipient Name<input name="toName" disabled></label><input name="toEmail" type="email" disabled>
    <input name="fromName" disabled><input name="fromEmail" type="email" disabled><input name="hiddenTrap" type="hidden">`;
  document.querySelector<HTMLInputElement>('[name="dimensionGiftCardType"]')!.addEventListener('click',()=>{
    setTimeout(()=>document.querySelectorAll<HTMLInputElement>('[name="giftcard-amount"]').forEach(el=>{el.disabled=false;}),40);
  });
  document.querySelectorAll<HTMLInputElement>('[name="giftcard-amount"]').forEach(el=>el.addEventListener('click',()=>{
    if(el.value==='other')document.querySelector<HTMLInputElement>('#dynamic-other')!.disabled=false;
    else document.querySelectorAll<HTMLInputElement>('[name="toName"],[name="toEmail"],[name="fromName"],[name="fromEmail"]').forEach(input=>{input.disabled=false;});
  }));
  document.querySelector<HTMLInputElement>('#dynamic-other')!.addEventListener('input',()=>{
    setTimeout(()=>document.querySelectorAll<HTMLInputElement>('[name="toName"],[name="toEmail"],[name="fromName"],[name="fromEmail"]').forEach(el=>{el.disabled=false;}),50);
  });
}
function checkoutFixture() {
  document.body.innerHTML=`<label>Country/Region<select name="countryCode"><option value="US">United States</option><option value="CN">China</option></select></label>
    <input name="firstName" autocomplete="given-name"><input name="lastName" autocomplete="family-name">
    <input name="postalCode" autocomplete="postal-code"><input name="street" autocomplete="address-line1">
    <input name="city" autocomplete="address-level2"><select name="state" autocomplete="address-level1"><option value="">Choose</option><option value="CA">California</option><option value="SH">Shanghai</option></select>
    <input name="fullDaytimePhone" autocomplete="tel" type="tel"><input name="emailAddress" autocomplete="email" type="email">
    <input name="cardNumber" autocomplete="cc-number" value="do-not-touch"><input name="cvv" type="password" value="secret">
    <button id="submit" type="submit">Place your order</button>`;
}
describe('Apple form filling',()=>{
  it('waits for dependent fields and fills a custom amount with independent From/To emails',async()=>{
    giftFixture();
    const result=await fillPage(profile(),{overwrite:false,timeoutMs:1000},document,'giftcard');
    expect(result.fields.every(field=>field.status==='filled')).toBe(true);
    expect(document.querySelector<HTMLInputElement>('#dynamic-other')!.value).toBe('20');
    expect(input('toEmail').value).toBe('recipient@example.com');
    expect(input('fromEmail').value).toBe('sender@example.com');
    expect(input('hiddenTrap').value).toBe('');
  });
  it('commits custom amount after React updates and waits for delivery fields to unlock',async()=>{
    giftFixture();
    const original=document.querySelector<HTMLInputElement>('#dynamic-other')!;
    const amount=original.cloneNode(true) as HTMLInputElement;
    original.replaceWith(amount);
    let committed='';
    amount.addEventListener('input',event=>{
      if(!event.composed)return;
      setTimeout(()=>{committed=amount.value;amount.setAttribute('value',committed);},200);
    });
    amount.addEventListener('blur',()=>{
      if(committed!==amount.value){amount.value='';return;}
      setTimeout(()=>document.querySelectorAll<HTMLInputElement>('[name="toName"],[name="toEmail"],[name="fromName"],[name="fromEmail"]').forEach(el=>{el.disabled=false;}),1500);
    });
    const result=await fillPage(profile(),{overwrite:false,timeoutMs:2500},document,'giftcard');
    expect(amount.value).toBe('20');
    expect(result.fields.every(field=>field.status==='filled')).toBe(true);
    expect(input('toEmail').value).toBe('recipient@example.com');
  });
  it('reports disabled delivery fields as an unconfirmed amount instead of missing fields',async()=>{
    giftFixture();
    const original=document.querySelector<HTMLInputElement>('#dynamic-other')!;
    original.replaceWith(original.cloneNode(true));
    const result=await fillPage(profile(),{overwrite:false,timeoutMs:200},document,'giftcard');
    expect(result.fields.find(field=>field.key==='amount')?.status).toBe('failed');
    expect(result.fields.filter(field=>['recipientName','recipientEmail','senderName','senderEmail'].includes(field.key)).every(field=>field.status==='failed'&&field.detail?.includes('尚未启用'))).toBe(true);
  });
  it('triggers the keyboard price formatter and waits for its delayed confirmed amount',async()=>{
    giftFixture();
    const original=document.querySelector<HTMLInputElement>('#dynamic-other')!;
    const amount=original.cloneNode(true) as HTMLInputElement;
    original.replaceWith(amount);
    let confirmed='25';
    const formatter=vi.fn((event:KeyboardEvent)=>{
      if(event.key!=='End')return;
      const next=amount.value;
      setTimeout(()=>{
        confirmed=next;
        document.querySelectorAll<HTMLInputElement>('[name="toName"],[name="toEmail"],[name="fromName"],[name="fromEmail"]').forEach(el=>{el.disabled=false;});
      },600);
    });
    amount.addEventListener('keydown',event=>formatter(event));
    amount.addEventListener('blur',()=>{amount.value=confirmed;});
    const result=await fillPage(profile(),{overwrite:true,timeoutMs:1500},document,'giftcard');
    expect(formatter).toHaveBeenCalledOnce();
    expect(amount.value).toBe('20');
    expect(result.fields.every(field=>field.status==='filled')).toBe(true);
  });
  it('uses Apple data-autom identifiers when field names and labels differ',async()=>{
    giftFixture();
    const keys=['toName','toEmail','fromName','fromEmail'];
    document.querySelector<HTMLInputElement>('[name="dimensionGiftCardType"]')!.click();
    document.querySelectorAll<HTMLInputElement>('[name="giftcard-amount"]').forEach(el=>{el.disabled=false;});
    document.querySelector<HTMLInputElement>('[name="giftcard-amount"][value="25"]')!.click();
    for(const key of keys){const el=input(key);el.dataset.autom=key;el.name='';el.disabled=false;}
    const result=await fillPage({...profile(),amount:'25'},{overwrite:true,timeoutMs:1000},document,'giftcard');
    expect(result.fields.every(field=>field.status==='filled')).toBe(true);
    expect(document.querySelector<HTMLInputElement>('[data-autom="toEmail"]')!.value).toBe('recipient@example.com');
  });
  it('supports a preset and preserves user edits unless replacement is requested',async()=>{
    giftFixture();
    input('toEmail').value='manual@example.com';
    const info={...profile(),amount:'25'};
    const result=await fillPage(info,{overwrite:false,timeoutMs:1000},document,'giftcard');
    expect(result.fields.find(field=>field.key==='recipientEmail')?.status).toBe('preserved');
    expect(input('toEmail').value).toBe('manual@example.com');
    await fillPage(info,{overwrite:true,timeoutMs:1000},document,'giftcard');
    expect(input('toEmail').value).toBe('recipient@example.com');
  });
  it('refills a delayed country reset and uses native setters for controlled inputs',async()=>{
    checkoutFixture();
    const first=input('firstName');let accepted='';
    Object.defineProperty(first,'value',{configurable:true,get(){return Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.get!.call(this);},set(){/* Simulates a controlled own-property setter. */}});
    first.addEventListener('input',()=>{accepted=first.value;});
    document.querySelector('select[name="countryCode"]')!.addEventListener('change',()=>{
      setTimeout(()=>document.querySelectorAll<HTMLInputElement>('input:not([type="password"])').forEach(el=>{if(!el.name.includes('card'))Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,'');}),600);
    });
    const result=await fillPage({...profile(),billingCountry:'CN',city:'Shanghai',state:'Shanghai',postalCode:'200000'},{overwrite:true,timeoutMs:1000},document,'checkout');
    expect(accepted).toBe('Example');
    expect(input('street').value).toBe('1 Example Street');
    expect(input('emailAddress').value).toBe('contact@example.com');
    expect(result.fields.filter(field=>field.status==='failed')).toEqual([]);
    expect(input('cardNumber').value).toBe('do-not-touch');
    expect(input('cvv').value).toBe('secret');
  });
  it('reports rejected inputs and never submits an order',async()=>{
    checkoutFixture();
    const submit=vi.fn();document.querySelector('#submit')!.addEventListener('click',submit);
    input('emailAddress').addEventListener('input',()=>{input('emailAddress').value='';});
    const result=await fillPage(profile(),{overwrite:true,timeoutMs:500},document,'checkout');
    expect(result.fields.find(field=>field.key==='contactEmail')?.status).toBe('failed');
    expect(submit).not.toHaveBeenCalled();
  });
  it.each(['2025550100','+1 202 555 0100'])('accepts Apple phone formatting for %s',async(phone)=>{
    checkoutFixture();
    input('fullDaytimePhone').addEventListener('blur',()=>{
      const el=input('fullDaytimePhone');
      if(['2025550100','12025550100'].includes(el.value.replace(/\D/g,'')))el.value='(202) 555-0100';
    });
    const result=await fillPage({...profile(),phone},{overwrite:true,timeoutMs:500},document,'checkout');
    expect(input('fullDaytimePhone').value).toBe('(202) 555-0100');
    expect(result.fields.find(field=>field.key==='phone')?.status).toBe('filled');
  });
  it('reports Apple validation errors even when the visible value was retained',async()=>{
    checkoutFixture();
    input('emailAddress').setAttribute('aria-invalid','true');
    const result=await fillPage(profile(),{overwrite:true,timeoutMs:150},document,'checkout');
    expect(input('emailAddress').value).toBe('contact@example.com');
    expect(result.fields.find(field=>field.key==='contactEmail')?.status).toBe('failed');
  });
  it('selects the ZIP-linked combined City, State dropdown',async()=>{
    checkoutFixture();
    input('city').remove();document.querySelector('select[name="state"]')!.remove();
    document.body.insertAdjacentHTML('beforeend','<select name="zipLookupCityState"><option value="">Choose</option><option value="cupertino-ca">Cupertino, CA</option><option value="san-jose-ca">San Jose, California</option></select>');
    const result=await fillPage(profile(),{overwrite:true,timeoutMs:500},document,'checkout');
    expect((document.querySelector('select[name="zipLookupCityState"]') as HTMLSelectElement).value).toBe('cupertino-ca');
    expect(result.fields.find(field=>field.key==='city')?.status).toBe('filled');
    expect(result.fields.find(field=>field.key==='state')?.status).toBe('filled');
  });
  it('does not clear the active country if a custom dropdown cannot be resolved',async()=>{
    checkoutFixture();
    const select=document.querySelector('select[name="countryCode"]')!;
    select.outerHTML='<input name="countryCode" role="combobox" value="United States" aria-controls="countries"><ul id="countries" role="listbox" hidden></ul>';
    const result=await fillPage({...profile(),billingCountry:'CN'},{overwrite:false,timeoutMs:150},document,'checkout');
    expect(result.fields.find(field=>field.key==='billingCountry')?.status).toBe('failed');
    expect(input('countryCode').value).toBe('United States');
    // A failed structural selection must not start writing address fields.
    expect(input('street').value).toBe('');
  });
});
