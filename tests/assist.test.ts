import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { assistPage,verifyBag } from '../lib/assist';
import { newProfile } from '../lib/profile';
const profile=()=>({...newProfile(),name:'Test',amount:'20',recipientName:'Recipient',recipientEmail:'recipient@example.com',senderName:'Sender',senderEmail:'sender@example.com'});
beforeEach(()=>{vi.spyOn(Element.prototype,'getClientRects').mockImplementation(function(this:Element){return (this.closest('[hidden]')?[]:[new DOMRect(0,0,100,30)]) as unknown as DOMRectList;});});
afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();});
function bag(){document.body.innerHTML=`<ol data-autom="bag-items"><li><a data-autom="bag-item-name">Apple Gift Card by Email</a><select data-autom="item-quantity-dropdown"><option value="1">1</option><option value="2">2</option></select><div data-autom="Monthly_price">$20.00</div><div class="rs-iteminfo-egcdetails"><div class="rs-iteminfo-child-tagline"><div class="rs-iteminfo-label">To:</div><div class="rs-iteminfo-egcemail"><span>Recipient</span> (<span>recipient@example.com</span>)</div></div><div class="rs-iteminfo-child-tagline"><div class="rs-iteminfo-label">From:</div><div class="rs-iteminfo-egcemail"><span>Sender</span> (<span>sender@example.com</span>)</div></div></div></li></ol><div data-autom="bagtotalvalue">$20.00</div><button>Check Out</button><button>Check out with Pay</button><button>Place your order</button>`;}
describe('one-click checkout boundaries',()=>{
  it('checks the complete bag before clicking only Check Out',async()=>{
    bag();const clicked=vi.fn();document.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>clicked(button.textContent)));
    expect(verifyBag(document,profile())).toBeNull();
    const result=await assistPage(profile(),{overwrite:false},document,'bag');expect(result.status).toBe('advanced');expect(clicked).toHaveBeenCalledExactlyOnceWith('Check Out');
  });
  it('refuses extra items, quantity, amount, or recipient changes',async()=>{
    for(const change of [()=>document.querySelector('ol')!.append(document.createElement('li')),()=>{document.querySelector('select')!.value='2';},()=>{document.querySelector('[data-autom="bagtotalvalue"]')!.textContent='$40.00';},()=>{document.querySelector('.rs-iteminfo-egcemail span:last-child')!.textContent='other@example.com';}]){
      bag();change();const clicked=vi.fn();document.querySelectorAll('button').forEach(button=>button.addEventListener('click',clicked));
      const result=await assistPage(profile(),{overwrite:false},document,'bag');expect(result.status).toBe('blocked');expect(clicked).not.toHaveBeenCalled();
    }
  });
  it('clicks Continue as Guest but never generic Continue or final purchase',async()=>{
    document.body.innerHTML='<button>Continue</button><button>Place your order</button><button>Continue as Guest</button>';const clicked=vi.fn();document.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>clicked(button.textContent)));
    await assistPage(profile(),{overwrite:false},document,'guest');expect(clicked).toHaveBeenCalledExactlyOnceWith('Continue as Guest');
    clicked.mockClear();document.querySelector('button:last-child')!.remove();expect((await assistPage(profile(),{overwrite:false},document,'guest')).status).toBe('blocked');expect(clicked).not.toHaveBeenCalled();
    expect((await assistPage(profile(),{overwrite:false},document,'checkout')).status).toBe('blocked');expect(clicked).not.toHaveBeenCalled();
  });
  it('opens delayed credit-card fields and fills contact email from sender if omitted',async()=>{
    document.body.innerHTML='<input type="radio" id="checkout.billing.billingoptions.credit"><button>Continue</button>';
    document.querySelector('input')!.addEventListener('click',()=>{setTimeout(()=>{document.body.insertAdjacentHTML('beforeend','<input autocomplete="cc-number"><input autocomplete="cc-exp"><select name="countryCode"><option value="US">United States</option></select><input name="emailAddress" type="email">');},50);});
    const clicked=vi.fn();document.querySelector('button')!.addEventListener('click',clicked);
    const result=await assistPage(profile(),{overwrite:false,timeoutMs:500},document,'checkout');
    expect(result.status).toBe('ready');expect(document.querySelector<HTMLInputElement>('[name="emailAddress"]')!.value).toBe('sender@example.com');expect(clicked).not.toHaveBeenCalled();
  });
  it('leaves browser-managed card data unread and untouched while replacing contact information',async()=>{
    document.body.innerHTML='<select name="countryCode"><option value="US">United States</option></select><input name="emailAddress" type="email" value="old@example.com"><input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc"><input autocomplete="cc-name">';
    const cardFields=Array.from(document.querySelectorAll<HTMLInputElement>('[autocomplete^="cc-"]'));
    const read=vi.fn(()=>{throw new Error('Payment values must not be read');});const write=vi.fn(()=>{throw new Error('Payment values must not be written');});
    for(const field of cardFields)Object.defineProperty(field,'value',{configurable:true,get:read,set:write});
    const result=await assistPage({...profile(),firstName:'Example'},{overwrite:true,timeoutMs:100},document,'checkout');
    expect(document.querySelector<HTMLInputElement>('[name="emailAddress"]')!.value).toBe('sender@example.com');
    expect(read).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();
    expect(result.fields.some(field=>field.key.startsWith('card')||field.key==='cvv')).toBe(false);
  });
  it('honors cancellation before a navigation click',async()=>{bag();const click=vi.fn();document.querySelector('button')!.addEventListener('click',click);expect((await assistPage(profile(),{overwrite:false,cancelled:()=>true},document,'bag')).status).toBe('blocked');expect(click).not.toHaveBeenCalled();});
});
