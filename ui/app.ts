import { extension, isPreview } from '../lib/platform';
import { loadStore, saveStore, watchStore } from '../lib/storage';
import { newProfile, validateProfile, parseImport, escapeHtml, PROFILE_FIELDS, type Profile, type ProfileField, type ProfileStore } from '../lib/profile';
import { APPLE_GIFTCARD_URL, classifyPage, type PageKind } from '../lib/page';
import { COUNTRIES, type FillResult } from '../lib/fill';
import { runFlow } from '../lib/flow';
import type { AssistResult } from '../lib/assist';

const icon = (name:string) => {
  const paths:Record<string,string>={
    gift:'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z"/>',
    plus:'<path d="M12 5v14M5 12h14"/>', edit:'<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6Z"/>',
    arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>', back:'<path d="m14 5-7 7 7 7"/>',
    copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
    check:'<path d="m5 12 4 4L19 6"/>', close:'<path d="m6 6 12 12M18 6 6 18"/>',
    download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>', upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
    trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',
    link:'<path d="M14 3h7v7M21 3l-9 9M10 3H3v18h18v-7"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]??paths.gift}</svg>`;
};
const e=escapeHtml;
const fieldLabels:Record<ProfileField,string>={
  name:'资料名称', amount:'礼品卡金额', recipientName:'收件人姓名', recipientEmail:'收件人邮箱',
  senderName:'发件人姓名', senderEmail:'发件人邮箱', contactEmail:'订单联系邮箱', phone:'联系电话',
  billingCountry:'国家 / 地区', firstName:'名 · First name', lastName:'姓 · Last name',
  street:'街道地址',street2:'公寓 / 门牌（选填）',city:'城市',state:'州 / 省',district:'区 / 县（选填）',postalCode:'邮编 / ZIP',
};
export async function mountApp(root:HTMLElement):Promise<void> {
  let store:ProfileStore;
  try { store=await loadStore(); } catch { root.textContent='读取资料失败，请关闭后重新打开扩展。'; return; }
  let draft:Profile|null=null;
  let errors:Partial<Record<ProfileField,string>>={};
  let dirty=false;
  let busy=false;
  let managing=document.body.classList.contains('options');
  let deletingId:string|null=null;
  let result:FillResult|null=null;
  let notice='';
  let tabId:number|undefined;
  let page:PageKind='unsupported';
  let status='点一下，自动打开苹果官网';
  let noticeTimer:ReturnType<typeof setTimeout>|undefined;
  let flowMessage='';let flowRunning=false;let flowCancelled=false;let flowTarget:number|undefined;
  if(!store.profiles.some(profile=>profile.id===store.selectedId)){
    store.selectedId=store.profiles[0]?.id??null;
    await saveStore(store);
  }

  const persist=async()=>{await saveStore(store);};
  function showNotice(message:string) {
    notice=message; clearTimeout(noticeTimer); renderNotice();
    noticeTimer=setTimeout(()=>{notice='';renderNotice();},5000);
  }
  function renderNotice() {
    const el=root.querySelector<HTMLElement>('#notice');
    if (el) { el.textContent=notice; el.hidden=!notice; }
  }
  async function refreshPage() {
    if (isPreview) { status='界面预览 · 安装扩展后可填写官网'; updateContext(); return; }
    try {
      const tabs=await extension!.tabs.query({active:true,currentWindow:true});
      const tab=tabs[0]; tabId=tab?.id;
      page=classifyPage(tab?.url??'');
      status=page==='unsupported'?'点一下，自动打开苹果官网':`已连接 · ${{giftcard:'礼品卡商品页',bag:'Apple 购物袋',guest:'访客结账',checkout:'Apple 结账页'}[page]}`;
    } catch { page='unsupported';status='切换到苹果页面后再试'; }
    updateContext();
  }
  function updateContext() {
    const ctx=root.querySelector<HTMLElement>('#page-status');
    if (ctx) { ctx.classList.toggle('connected',page!=='unsupported');ctx.textContent=status; }
    const flowButton=root.querySelector<HTMLButtonElement>('#start-flow');if(flowButton)flowButton.disabled=busy||isPreview;
    root.querySelectorAll<HTMLButtonElement>('[data-select],[data-edit],[data-copy],#new-profile,#import,#manage').forEach(button=>{button.disabled=busy;});
  }
  function render() {
    root.innerHTML=`<div class="shell">
      <header class="brand"><span class="brand-mark">${icon('gift')}</span><div><span class="brand-name">GiftFill</span><span class="brand-subtitle">礼卡快填</span></div><span class="store-badge">US STORE</span></header>
      <div id="notice" class="notice" role="status" ${notice?'':'hidden'}>${e(notice)}</div>
      ${draft?renderEditor():managing?renderManagement():renderHome()}
      <footer>${icon('lock')}<span>资料仅存本地</span><span class="version">v0.3.0</span></footer>
      <input id="import-file" type="file" accept=".json,application/json" hidden>
    </div>`;
    bindCommon();
    if (draft) bindEditor(); else bindProfiles();
    updateContext();
  }
  function renderHome():string {
    const selected=store.profiles.find(profile=>profile.id===store.selectedId);
    if(!selected)return `<div class="home-heading"><span></span><button id="manage" class="text-button">管理资料</button></div><div class="empty-state"><span class="empty-graphic">${icon('gift')}</span><h1>先保存一份资料</h1><p>存好金额、邮箱与账单地址，<br>下次点一下就能准备订单。</p><button id="first-profile" class="primary-button">创建资料</button></div>`;
    return `<div class="home-heading"><h1>准备你的礼品卡</h1><button id="manage" class="text-button">管理资料</button></div>
      <p class="home-description">选好资料，剩下的交给 GiftFill。</p>
      ${store.profiles.length>1?`<label class="form-field profile-picker"><span>使用资料</span><select id="selected-profile" ${busy?'disabled':''}>${store.profiles.map(profile=>`<option value="${e(profile.id)}" ${profile.id===selected.id?'selected':''}>${e(profile.name)}</option>`).join('')}</select></label>`:''}
      <section class="ready-card"><span class="ready-label">${e(selected.name)}</span><div class="ready-amount"><small>$</small>${e(selected.amount)}<span>USD</span></div><span class="ready-email">${e(selected.recipientEmail||'请先补全收件邮箱')}</span><span class="ready-route">${e(selected.billingCountry)}${selected.city?' · '+e(selected.city):''}</span></section>
      <div class="one-click">${flowRunning?`<button id="stop-flow" class="secondary-button">停止</button>`:`<button id="start-flow" class="primary-button">${icon('arrow')}一键开始</button>`}<p>自动填好资料，停在付款前。<br>银行卡由浏览器或密码管理器填写。</p></div>
      ${renderResult()}<div class="home-status"><span id="page-status" class="page-status"></span></div>`;
  }
  function renderManagement():string {
    const cards=store.profiles.map(profile=>`<article class="profile-card ${profile.id===store.selectedId?'selected':''}">
      <button type="button" class="profile-select" data-select="${e(profile.id)}" aria-label="选择资料 ${e(profile.name)}" aria-pressed="${profile.id===store.selectedId}">
        <span class="profile-top"><span class="profile-name">${e(profile.name)}</span><span class="amount"><small>$</small>${e(profile.amount)}</span></span>
        <span class="profile-recipient">${e(profile.recipientEmail||'尚未填写收件邮箱')}</span>
        <span class="profile-meta">${e(profile.billingCountry)}${profile.city?' · '+e(profile.city):''}<span>${profile.id===store.selectedId?'已选用':'点击选用'}</span></span>
      </button>
      <div class="card-actions"><button class="text-button" data-edit="${e(profile.id)}">${icon('edit')}编辑</button><button class="icon-button" data-copy="${e(profile.id)}" aria-label="复制 ${e(profile.name)}" title="复制资料">${icon('copy')}</button></div>
    </article>`).join('');
    return `<div class="editor-heading"><button id="home" class="icon-button" aria-label="返回一键开始">${icon('back')}</button><h1>管理资料</h1><button id="new-profile" class="add-button" aria-label="新增资料">${icon('plus')}</button></div>
      <p class="management-help">编辑、备份常用资料。选中后返回即可使用。</p>
      ${store.profiles.length?`<div class="profile-list">${cards}</div>`:`<button id="first-profile" class="primary-button">创建资料</button>`}
      <div class="data-toolbar"><button id="import" class="text-button">${icon('upload')}导入资料</button><button id="export" class="text-button" ${store.profiles.length?'':'disabled'}>${icon('download')}导出备份</button></div>
      <p class="backup-note" id="backup-note" hidden>备份包含邮箱、电话和地址，请妥善保存。</p>`;
  }
  function renderResult():string {
    if (!result && !busy) return '';
    if (busy) return `<section class="result-panel" aria-live="polite"><span class="spinner"></span><strong>正在准备订单…</strong><p>${e(flowMessage)}</p></section>`;
    if (result!.error) return `<section class="result-panel warning" aria-live="polite"><strong>需要你处理一下</strong><p>${e(result!.error)}</p></section>`;
    const filled=result!.fields.filter(field=>field.status==='filled').length;
    const unfinished=result!.fields.filter(field=>field.status==='failed'||field.status==='missing').length;
    return `<section class="result-panel ${unfinished?'warning':'success'}" aria-live="polite"><div class="result-title">${icon(unfinished?'edit':'check')}<strong>${unfinished?'有 '+unfinished+' 项需要检查':'资料已准备好'}</strong></div><p>${unfinished?'展开详情查看需处理的字段。':'用浏览器或密码管理器填入银行卡，核对后自行完成购买。'}</p><details class="result-details"><summary>查看填写详情 · ${filled} 项已核对</summary><ul>${result!.fields.map(field=>`<li><span class="result-dot ${field.status}"></span><span>${e(field.label)}</span><span class="field-status">${{filled:'已核对',preserved:'已保留',missing:'未找到',failed:'请检查'}[field.status]}</span>${field.detail?`<small>${e(field.detail)}</small>`:''}</li>`).join('')}</ul></details></section>`;
  }
  function inputField(key:ProfileField, options:{type?:string;placeholder?:string;wide?:boolean}={}):string {
    return `<label class="form-field ${options.wide?'wide':''}"><span>${e(fieldLabels[key])}</span><input name="${key}" value="${e(draft![key])}" type="${options.type??'text'}" placeholder="${e(options.placeholder??'')}" maxlength="500" ${errors[key]?'aria-invalid="true" aria-describedby="error-'+key+'"':''}><small id="error-${key}" class="field-error">${e(errors[key]??'')}</small></label>`;
  }
  function renderEditor():string {
    const existing=store.profiles.some(profile=>profile.id===draft!.id);
    const us=draft!.billingCountry==='US';
    return `<form id="profile-form" novalidate>
      <div class="editor-heading"><button id="back" type="button" class="icon-button" aria-label="返回资料列表">${icon('back')}</button><h1>${existing?'编辑资料':'新增资料'}</h1><span class="autosave-note">${dirty?'有未保存的修改':'填写后保存'}</span></div>
      <section class="form-section"><div class="form-section-heading"><span class="step">01</span><h2>这次送多少</h2></div>
        ${inputField('name',{placeholder:'例如：自己充值 · 每月 $20',wide:true})}
        <label class="form-field amount-field"><span>礼品卡金额 <small>USD</small></span><div class="amount-input"><span>$</span><input name="amount" value="${e(draft!.amount)}" type="number" min="10" max="2000" step="0.01" inputmode="decimal" ${errors.amount?'aria-invalid="true"':''}></div><small class="field-error" id="error-amount">${e(errors.amount??'')}</small></label>
        <div class="amount-presets" aria-label="常用金额">${['20','25','50','100'].map(amount=>`<button type="button" data-amount="${amount}" class="${draft!.amount===amount?'active':''}">$${amount}</button>`).join('')}</div>
      </section>
      <section class="form-section"><div class="form-section-heading"><span class="step">02</span><h2>From / To</h2><button id="same-sender" type="button" class="text-button">送给自己</button></div><p class="section-help">礼品卡发送到收件人邮箱。</p>
        <div class="form-grid">${inputField('recipientName',{placeholder:'Recipient name'})}${inputField('senderName',{placeholder:'Sender name'})}${inputField('recipientEmail',{type:'email',wide:true,placeholder:'you@example.com'})}${inputField('senderEmail',{type:'email',wide:true,placeholder:'you@example.com'})}</div>
      </section>
      <section class="form-section"><div class="form-section-heading"><span class="step">03</span><h2>联系与账单</h2></div><p class="section-help">联系邮箱留空时使用发件邮箱。请填写实际账单地址。</p>
        <div class="form-grid">${inputField('contactEmail',{type:'email',wide:true,placeholder:'默认使用发件邮箱'})}${inputField('phone',{type:'tel',wide:true,placeholder:'+1 …'})}
          <label class="form-field wide"><span>账单国家 / 地区</span><select name="billingCountry">${Object.entries(COUNTRIES).map(([code,label])=>`<option value="${code}" ${draft!.billingCountry===code?'selected':''}>${label}</option>`).join('')}</select><small class="field-error">${e(errors.billingCountry??'')}</small></label>
          ${inputField('firstName')}${inputField('lastName')}${inputField('street',{wide:true})}${inputField('street2',{wide:true})}${inputField('postalCode',{placeholder:us?'5 位 ZIP':''})}${inputField('city')}${inputField('state',{placeholder:us?'例如 CA 或 California':''})}${!us?inputField('district'):''}
        </div>
      </section>
      ${deletingId===draft!.id?`<div class="delete-confirm"><p>删除「${e(draft!.name)}」？</p><div><button id="cancel-delete" type="button" class="secondary-button">取消</button><button id="confirm-delete" type="button" class="danger-button">确认删除</button></div></div>`:''}
      <div class="editor-save"><button type="submit" class="primary-button" id="save-profile">${icon('check')}保存资料</button>${existing?`<button id="delete-profile" type="button" class="icon-button delete-button" aria-label="删除这份资料">${icon('trash')}</button>`:''}</div>
    </form>`;
  }
  function bindCommon() {
    root.querySelector<HTMLInputElement>('#import-file')?.addEventListener('change',async event=> {
      const input=event.target as HTMLInputElement;const file=input.files?.[0];if(!file)return;
      try {
        if(file.size>1_000_000)throw new Error('文件过大，请选择小于 1 MB 的备份');
        const profiles=parseImport(await file.text());
        if(store.profiles.length+profiles.length>100)throw new Error('最多保存 100 份资料');
        store.profiles.push(...profiles);store.selectedId??=profiles[0]?.id??null;
        await persist();showNotice(`已导入 ${profiles.length} 份资料`);render();
      } catch(error){showNotice(error instanceof Error?error.message:'导入失败');}
      input.value='';
    });
  }
  function edit(profile?:Profile) {draft=profile?{...profile}:newProfile();dirty=false;errors={};deletingId=null;render();root.querySelector<HTMLInputElement>('[name="name"]')?.focus();}
  function bindProfiles() {
    root.querySelector('#new-profile')?.addEventListener('click',()=>edit());
    root.querySelector('#first-profile')?.addEventListener('click',()=>edit());
    root.querySelector('#home')?.addEventListener('click',()=>{managing=false;render();});
    root.querySelector('#manage')?.addEventListener('click',()=>{managing=true;render();});
    root.querySelector<HTMLSelectElement>('#selected-profile')?.addEventListener('change',async event=>{
      const previous=store.selectedId;store.selectedId=(event.target as HTMLSelectElement).value;
      try{await persist();result=null;flowMessage='';render();}catch{store.selectedId=previous;showNotice('选择未保存，请重试');render();}
    });
    root.querySelectorAll<HTMLButtonElement>('[data-select]').forEach(button=>button.addEventListener('click',async()=>{
      const previous=store.selectedId;store.selectedId=button.dataset.select!;
      try{await persist();result=null;render();}catch{store.selectedId=previous;showNotice('选择未保存，请重试');render();}
    }));
    root.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach(button=>button.addEventListener('click',()=>edit(store.profiles.find(profile=>profile.id===button.dataset.edit))));
    root.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach(button=>button.addEventListener('click',()=>{const original=store.profiles.find(profile=>profile.id===button.dataset.copy)!;edit({...original,id:crypto.randomUUID(),name:original.name+' · 副本'});dirty=true;}));
    root.querySelector('#start-flow')?.addEventListener('click',()=>{void startFlow();});
    root.querySelector('#stop-flow')?.addEventListener('click',()=>{flowCancelled=true;flowMessage='正在停止…';if(flowTarget!==undefined)void extension!.tabs.sendMessage(flowTarget,{type:'GIFTFILL_STOP'}).catch(()=>{});render();});
    root.querySelector('#import')?.addEventListener('click',()=>root.querySelector<HTMLInputElement>('#import-file')!.click());
    root.querySelector('#export')?.addEventListener('click',()=> {
      const backup={app:'giftfill',version:1,exportedAt:new Date().toISOString(),profiles:store.profiles};
      const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download=`giftfill-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      root.querySelector<HTMLElement>('#backup-note')!.hidden=false;showNotice('备份已导出，内含联系资料，请妥善保存');
    });
  }
  function readDraft() {
    const form=root.querySelector<HTMLFormElement>('#profile-form');if(!form||!draft)return;
    const values=new FormData(form);
    for(const key of PROFILE_FIELDS){const value=values.get(key);if(typeof value==='string')draft[key]=value.trim();}
  }
  function bindEditor() {
    root.querySelector('#profile-form')!.addEventListener('input',()=>{readDraft();dirty=true;const hint=root.querySelector('.autosave-note');if(hint)hint.textContent='有未保存的修改';});
    root.querySelector<HTMLSelectElement>('[name="billingCountry"]')!.addEventListener('change',()=>{readDraft();dirty=true;render();});
    root.querySelector('#back')!.addEventListener('click',()=> {
      readDraft();if(dirty&&!window.confirm('有未保存的修改，确定返回吗？'))return;draft=null;deletingId=null;render();
    });
    root.querySelectorAll<HTMLButtonElement>('[data-amount]').forEach(button=>button.addEventListener('click',()=>{readDraft();draft!.amount=button.dataset.amount!;dirty=true;render();}));
    root.querySelector('#same-sender')!.addEventListener('click',()=>{readDraft();draft!.senderName=draft!.recipientName;draft!.senderEmail=draft!.recipientEmail;dirty=true;render();});
    root.querySelector('#profile-form')!.addEventListener('submit',async event=> {
      event.preventDefault();readDraft();errors=validateProfile(draft!);
      if(Object.keys(errors).length){render();root.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();return;}
      if(store.profiles.length>=100&&!store.profiles.some(profile=>profile.id===draft!.id)){showNotice('最多保存 100 份资料');return;}
      const button=root.querySelector<HTMLButtonElement>('#save-profile')!;button.disabled=true;
      const previous=structuredClone(store);
      try {
        draft!.updatedAt=new Date().toISOString();
        const index=store.profiles.findIndex(profile=>profile.id===draft!.id);
        if(index===-1)store.profiles.push({...draft!});else store.profiles[index]={...draft!};
        store.selectedId=draft!.id;await persist();draft=null;dirty=false;managing=false;result=null;flowMessage='';showNotice('资料已保存，下次点「一键开始」即可');render();
      }catch{store=previous;showNotice('保存失败，请重试');button.disabled=false;}
    });
    root.querySelector('#delete-profile')?.addEventListener('click',()=>{readDraft();deletingId=draft!.id;render();root.querySelector<HTMLButtonElement>('#cancel-delete')?.focus();});
    root.querySelector('#cancel-delete')?.addEventListener('click',()=>{deletingId=null;render();});
    root.querySelector('#confirm-delete')?.addEventListener('click',async()=> {
      const previous=structuredClone(store);
      try{store.profiles=store.profiles.filter(profile=>profile.id!==deletingId);if(store.selectedId===deletingId)store.selectedId=store.profiles[0]?.id??null;await persist();draft=null;deletingId=null;dirty=false;showNotice('资料已删除');render();}
      catch{store=previous;showNotice('删除失败，请重试');}
    });
  }
  async function startFlow(){
    if(busy||isPreview)return;
    const source=store.profiles.find(item=>item.id===store.selectedId);if(!source)return;
    const required:ProfileField[]=['recipientName','recipientEmail','senderName','senderEmail'];
    const missing=required.filter(key=>!source[key].trim());
    if(missing.length){
      draft={...source};errors=Object.fromEntries(missing.map(key=>[key,'请填写'+fieldLabels[key]]));dirty=false;deletingId=null;
      showNotice('先补全收发件资料，保存后即可一键开始');render();root.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();return;
    }
    const profile={...source};
    const runId=crypto.randomUUID();busy=true;flowRunning=true;flowCancelled=false;result=null;flowMessage='正在打开购买流程…';render();
    try{
      const tabs=await extension!.tabs.query({currentWindow:true});
      const active=tabs.find(tab=>tab.active);
      const existing=active&&classifyPage(active.url??'')!=='unsupported'?active:tabs.filter(tab=>classifyPage(tab.url??'')!=='unsupported').sort((a,b)=>(b.lastAccessed??0)-(a.lastAccessed??0))[0];
      const targetTab=existing??await extension!.tabs.create({url:APPLE_GIFTCARD_URL});
      if(targetTab.id===undefined)throw new Error('tab missing');
      const target=targetTab.id;flowTarget=target;
      if(existing&&!existing.active)await extension!.tabs.update(target,{active:true});
      result=await runFlow({
        read:async()=>{
          const tab=await extension!.tabs.get(target);const currentPage=classifyPage(tab.url??'');
          if(tab.status!=='complete')return {page:currentPage,ready:false};
          if(currentPage==='unsupported')return {page:currentPage,ready:true};
          try{const state=await extension!.tabs.sendMessage(target,{type:'GIFTFILL_STATUS'});return {page:currentPage,ready:state?.page===currentPage};}
          catch{return {page:currentPage,ready:false};}
        },
        cancelled:()=>flowCancelled,
        update:message=>{flowMessage=message;render();},
        act:async currentPage=>{
          if(flowCancelled)throw new Error('cancelled');
          const port=extension!.tabs.connect(target,{name:'giftfill-run'});
          try{
            return await extension!.tabs.sendMessage(target,{type:'GIFTFILL_ASSIST',expectedPage:currentPage,profile,runId});
          }finally{port.disconnect();}
        },
      });
      flowMessage=(result as AssistResult).message;
    }catch{result={page,fields:[],error:'目标标签页已关闭或未连接，请刷新苹果页面后重试。'};flowMessage='快捷流程已停止';}
    finally{busy=false;flowRunning=false;flowTarget=undefined;render();}
  }
  render();await refreshPage();
  watchStore(()=>{if(!draft&&!busy)void loadStore().then(updated=>{store=updated;render();});});
  if(!isPreview){
    extension!.tabs.onActivated.addListener(()=>{void refreshPage();});
    extension!.tabs.onUpdated.addListener((_id,change)=>{if(change.url||change.status==='complete')void refreshPage();});
  }
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();}});
}
