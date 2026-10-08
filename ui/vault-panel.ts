import { extension, isPreview } from '../lib/platform';
import { createVault, unlockVault, parseCard, VaultSession, type EncryptedVault, type VaultData } from '../lib/vault';
import { escapeHtml as e } from '../lib/profile';

const KEY='giftfill.payment-vault.v1';
async function load():Promise<EncryptedVault|null>{if(isPreview)return JSON.parse(localStorage.getItem(KEY)??'null');const values=await extension!.storage.local.get(KEY);return values[KEY] as EncryptedVault??null;}
async function save(value:EncryptedVault){if(isPreview)localStorage.setItem(KEY,JSON.stringify(value));else await extension!.storage.local.set({[KEY]:value});}

export async function createVaultPanel(changed:()=>void) {
  const session=new VaultSession();let encrypted=await load();let expanded=false;let adding=false;let working=false;let error='';let deleting:string|null=null;
  async function commit(data:VaultData){
    const next=await session.seal(data);
    // Reject concurrent changes from another options page rather than overwriting them.
    const latest=await load();if(JSON.stringify(latest)!==JSON.stringify(encrypted)){session.lock();encrypted=latest;throw new Error('卡库已在另一个面板更新，请重新解锁');}
    await save(next);encrypted=next;session.accept(data);
  }
  async function operation(action:()=>Promise<void>,root:HTMLElement){
    if(working)return;working=true;error='';root.querySelectorAll<HTMLButtonElement>('[data-vault] button').forEach(button=>button.disabled=true);
    try{await action();}catch(cause){error=cause instanceof Error?cause.message:'卡库操作失败，请重试';}
    finally{working=false;changed();}
  }
  const timer=setInterval(()=>{const was=!!session.snapshot;if(!was&&expanded&&adding){adding=false;changed();}if(!session.unlocked&&rootHasUnlockState()){changed();}},1000);
  function rootHasUnlockState(){return !!document.querySelector('[data-vault-unlocked]');}
  window.addEventListener('pagehide',()=>{session.lock();clearInterval(timer);});
  return {
    session,
    render(profileId:string|null):string {
      const data=session.snapshot;
      const subtitle=data?`${data.cards.length} 张卡 · 5 分钟闲置后锁定`:encrypted?'已锁定 · 仅本地加密保存':'卡号和有效期加密保存';
      const field=(label:string,name:string,type='text',extra='')=>`<label class="form-field"><span>${label}</span><input name="${name}" type="${type}" autocomplete="off" ${extra}></label>`;
      return `<section class="vault-panel" data-vault ${data?'data-vault-unlocked':''}><div class="vault-heading"><button id="vault-toggle" class="vault-title" aria-expanded="${expanded}"><span class="vault-symbol">▣</span><span><strong>付款卡库</strong><small>${e(subtitle)}</small></span></button>${data?'<button id="vault-lock" class="text-button">锁定</button>':''}</div>
        ${data&&profileId?`<label class="form-field vault-choice"><span>当前资料使用的卡片</span><select id="vault-card"><option value="">由浏览器 / 自己填写银行卡</option>${data.cards.map(card=>`<option value="${e(card.id)}" ${data.bindings[profileId]===card.id?'selected':''}>${e(card.name)} · •••• ${e(card.number.slice(-4))}</option>`).join('')}</select></label>`:''}
        ${expanded?`<div class="vault-body">${error?`<p class="vault-error" role="alert">${e(error)}</p>`:''}${!data?`<form id="vault-unlock" autocomplete="off">${field(encrypted?'解锁口令':'设置解锁口令','passphrase','password','minlength="12" maxlength="256" required')}${!encrypted?field('再次输入口令','confirmation','password','minlength="12" maxlength="256" required'):''}<p class="vault-note">${encrypted?'解锁后可选择保存的卡片。':'使用至少 12 字符的独立口令。忘记后无法恢复卡库。'}<br>CVV 每次在苹果页面输入，卡库不保存。</p><button type="submit" class="secondary-button" ${working?'disabled':''}>${encrypted?'解锁卡库':'创建加密卡库'}</button></form>`:
          `${adding?`<form id="vault-add" autocomplete="off">${field('卡片昵称','cardName','text','maxlength="80" required')}${field('银行卡号','cardNumber','password','inputmode="numeric" maxlength="30" required')}${field('有效期 MM/YY','expiry','text','inputmode="numeric" maxlength="7" placeholder="MM/YY" required')}<p class="vault-note">保存后仅显示昵称和末四位。请使用真实账单资料；CVV 不保存。</p><div class="vault-buttons"><button type="submit" class="secondary-button">加密保存</button><button id="vault-cancel" type="button" class="text-button">取消</button></div></form>`:
          `<div class="vault-cards">${data.cards.map(card=>`<div class="vault-row"><span><strong>${e(card.name)}</strong><small>•••• ${e(card.number.slice(-4))}</small></span><button type="button" class="text-button" data-delete-card="${e(card.id)}">移除</button></div>${deleting===card.id?`<div class="delete-confirm"><p>移除这张卡后需重新录入。</p><div><button id="vault-keep" class="text-button">取消</button><button id="vault-remove" class="danger-button">确认移除</button></div></div>`:''}`).join('')}</div><button id="vault-new" class="text-button" ${data.cards.length>=30?'disabled':''}>＋ 添加银行卡</button><p class="vault-note">解锁只在当前面板有效。备份仅含联系资料，银行卡不会导出。</p>`}`}</div>`:''}</section>`;
    },
    bind(root:HTMLElement,profileId:string|null) {
      root.querySelector('#vault-toggle')?.addEventListener('click',()=>{expanded=!expanded;error='';adding=false;changed();});
      root.querySelector('#vault-lock')?.addEventListener('click',()=>{session.lock();adding=false;deleting=null;changed();});
      root.querySelector('#vault-new')?.addEventListener('click',()=>{adding=true;error='';session.touch();changed();root.querySelector<HTMLInputElement>('[name="cardName"]')?.focus();});
      root.querySelector('#vault-cancel')?.addEventListener('click',()=>{adding=false;changed();});
      root.querySelector('#vault-unlock')?.addEventListener('submit',event=>{
        event.preventDefault();const form=event.target as HTMLFormElement;const values=new FormData(form);let password=String(values.get('passphrase')??'');const confirmation=String(values.get('confirmation')??'');form.reset();
        void operation(async()=>{
          if(!encrypted){if(password!==confirmation)throw new Error('两次口令不一致');const created=await createVault(password);if(await load())throw new Error('卡库已在其他面板创建，请重新打开');await save(created.encrypted);encrypted=created.encrypted;session.set(created.key,created.data,encrypted.salt);adding=true;}
          else {encrypted=await load();if(!encrypted)throw new Error('卡库不存在，请重新打开面板');const unlocked=await unlockVault(encrypted,password);session.set(unlocked.key,unlocked.data,encrypted.salt);}
          password='';
        },root).finally(()=>{password='';});
      });
      root.querySelector('#vault-add')?.addEventListener('submit',event=>{
        event.preventDefault();const form=event.target as HTMLFormElement;const values=new FormData(form);const input={name:String(values.get('cardName')??''),number:String(values.get('cardNumber')??''),expiry:String(values.get('expiry')??'')};form.reset();
        void operation(async()=>{const data=session.snapshot;if(!data)throw new Error('卡库已锁定');if(data.cards.length>=30)throw new Error('最多保存 30 张卡');const card=parseCard(input);if(data.cards.some(existing=>existing.number===card.number))throw new Error('这张银行卡已保存');const next=structuredClone(data);next.cards.push(card);if(profileId)next.bindings[profileId]=card.id;await commit(next);adding=false;input.number='';},root).finally(()=>{input.number='';});
      });
      root.querySelector<HTMLSelectElement>('#vault-card')?.addEventListener('change',event=>{const value=(event.target as HTMLSelectElement).value;void operation(async()=>{const data=session.snapshot;if(!data||!profileId)throw new Error('请先解锁');const next=structuredClone(data);if(value)next.bindings[profileId]=value;else delete next.bindings[profileId];await commit(next);},root);});
      root.querySelectorAll<HTMLButtonElement>('[data-delete-card]').forEach(button=>button.addEventListener('click',()=>{deleting=button.dataset.deleteCard!;changed();}));
      root.querySelector('#vault-keep')?.addEventListener('click',()=>{deleting=null;changed();});
      root.querySelector('#vault-remove')?.addEventListener('click',()=>{void operation(async()=>{const data=session.snapshot;if(!data)throw new Error('请先解锁');const next=structuredClone(data);next.cards=next.cards.filter(card=>card.id!==deleting);for(const [id,cardId]of Object.entries(next.bindings))if(cardId===deleting)delete next.bindings[id];await commit(next);deleting=null;},root);});
    },
  };
}
