import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { assistPage,verifyBag,fillPayment } from '../lib/assist';
import { newProfile } from '../lib/profile';
const profile=()=>({...newProfile(),name:'Test',amount:'20',recipientName:'Recipient',recipientEmail:'recipient@example.com',senderName:'Sender',senderEmail:'sender@example.com'});
const card={id:'test-card',name:'Synthetic Visa',number:'4111111111111111',expiry:'12/29'};
beforeEach(()=>{vi.spyOn(Element.prototype,'getClientRects').mockImplementation(function(this:Element){return (this.closest('[hidden]')?[]:[new DOMRect(0,0,100,30)]) as unknown as DOMRectList;});});
afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();});
function bag(){document.body.innerHTML=`<ol data-autom="bag-items"><li><a data-autom="bag-item-name">Apple Gift Card by Email</a><select data-autom="item-quantity-dropdown"><option value="1">1</option><option value="2">2</option></select><div data-autom="Monthly_price">$20.00</div><div class="rs-iteminfo-egcdetails"><div class="rs-iteminfo-child-tagline"><div class="rs-iteminfo-label">To:</div><div class="rs-iteminfo-egcemail"><span>Recipient</span> (<span>recipient@example.com</span>)</div></div><div class="rs-iteminfo-child-tagline"><div class="rs-iteminfo-label">From:</div><div class="rs-iteminfo-egcemail"><span>Sender</span> (<span>sender@example.com</span>)</div></div></div></li></ol><div data-autom="bagtotalvalue">$20.00</div><button>Check Out</button><button>Check out with Pay</button><button>Place your order</button>`;}
describe('assisted checkout and card boundaries',()=>{
  it('checks the complete bag before clicking only Check Out',async()=>{
    bag();const clicked=vi.fn();document.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>clicked(button.textContent)));
    expect(verifyBag(document,profile())).toBeNull();
    const result=await assistPage(profile(),{overwrite:false,navigate:true},document,'bag');expect(result.status).toBe('advanced');expect(clicked).toHaveBeenCalledExactlyOnceWith('Check Out');
  });
  it('refuses extra items, quantity, amount, or recipient changes',async()=>{
    for(const change of [()=>document.querySelector('ol')!.append(document.createElement('li')),()=>{document.querySelector('select')!.value='2';},()=>{document.querySelector('[data-autom="bagtotalvalue"]')!.textContent='$40.00';},()=>{document.querySelector('.rs-iteminfo-egcemail span:last-child')!.textContent='other@example.com';}]){
      bag();change();const clicked=vi.fn();document.querySelectorAll('button').forEach(button=>button.addEventListener('click',clicked));
      const result=await assistPage(profile(),{overwrite:false,navigate:true},document,'bag');expect(result.status).toBe('blocked');expect(clicked).not.toHaveBeenCalled();
    }
  });
  it('clicks Continue as Guest but never generic Continue or final purchase',async()=>{
    document.body.innerHTML='<button>Continue</button><button>Place your order</button><button>Continue as Guest</button>';const clicked=vi.fn();document.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>clicked(button.textContent)));
    await assistPage(profile(),{overwrite:false,navigate:true},document,'guest');expect(clicked).toHaveBeenCalledExactlyOnceWith('Continue as Guest');
    clicked.mockClear();document.querySelector('button:last-child')!.remove();expect((await assistPage(profile(),{overwrite:false,navigate:true},document,'guest')).status).toBe('blocked');expect(clicked).not.toHaveBeenCalled();
    expect((await assistPage(profile(),{overwrite:false,navigate:true,card},document,'checkout')).status).toBe('blocked');expect(clicked).not.toHaveBeenCalled();
  });
  it('fills only a uniquely identified card and leaves CVV and final Continue untouched',async()=>{
    document.body.innerHTML='<input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc" value="123"><button>Continue</button><button>Place your order</button>';
    const clicks=vi.fn();document.querySelectorAll('button').forEach(button=>button.addEventListener('click',clicks));
    const fields=await fillPayment(card,document);expect(fields[0]?.status).toBe('filled');expect(fields[1]?.status).toBe('filled');expect(JSON.stringify(fields)).not.toContain(card.number);
    expect(document.querySelector<HTMLInputElement>('[autocomplete="cc-csc"]')!.value).toBe('123');expect(clicks).not.toHaveBeenCalled();
    document.querySelector<HTMLInputElement>('[autocomplete="cc-number"]')!.value='5555555555554444';
    expect((await fillPayment(card,document))[0]?.status).toBe('preserved');expect(document.querySelector<HTMLInputElement>('[autocomplete="cc-number"]')!.value).toBe('5555555555554444');
    document.body.insertAdjacentHTML('beforeend','<input autocomplete="cc-number">');expect((await fillPayment(card,document))[0]?.status).toBe('missing');
  });
  it('opens delayed credit-card fields and fills contact email from sender if omitted',async()=>{
    document.body.innerHTML='<input type="radio" id="checkout.billing.billingoptions.credit"><button>Continue</button>';
    document.querySelector('input')!.addEventListener('click',()=>{setTimeout(()=>{document.body.insertAdjacentHTML('beforeend','<input autocomplete="cc-number"><input autocomplete="cc-exp"><select name="countryCode"><option value="US">United States</option></select><input name="emailAddress" type="email">');},50);});
    const clicked=vi.fn();document.querySelector('button')!.addEventListener('click',clicked);
    const result=await assistPage(profile(),{overwrite:false,navigate:true,card,timeoutMs:500},document,'checkout');
    expect(result.status).toBe('ready');expect(document.querySelector<HTMLInputElement>('[name="emailAddress"]')!.value).toBe('sender@example.com');expect(clicked).not.toHaveBeenCalled();
  });
  it('honors cancellation before a navigation click',async()=>{bag();const click=vi.fn();document.querySelector('button')!.addEventListener('click',click);expect((await assistPage(profile(),{overwrite:false,navigate:true,cancelled:()=>true},document,'bag')).status).toBe('blocked');expect(click).not.toHaveBeenCalled();});
});
