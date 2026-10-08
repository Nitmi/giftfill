import { extension, isPreview } from '../lib/platform';
import { loadStore, saveStore, watchStore } from '../lib/storage';
import { newProfile, validateProfile, parseImport, escapeHtml, PROFILE_FIELDS, type Profile, type ProfileField, type ProfileStore } from '../lib/profile';
import { APPLE_GIFTCARD_URL, classifyPage, type PageKind } from '../lib/page';
import { COUNTRIES, type FillResult } from '../lib/fill';

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
  let overwrites=false;
  let deletingId:string|null=null;
  let result:FillResult|null=null;
  let notice='';
  let tabId:number|undefined;
  let page:PageKind='unsupported';
  let status='打开美区 Apple Gift Card 购买页开始';
  let noticeTimer:ReturnType<typeof setTimeout>|undefined;

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
      status=page==='giftcard'?'已连接 · 礼品卡商品页':page==='checkout'?'已连接 · Apple 结账页':'打开美区 Apple Gift Card 购买页开始';
    } catch { page='unsupported';status='切换到苹果页面后再试'; }
    updateContext();
  }
  function updateContext() {
    const ctx=root.querySelector<HTMLElement>('#page-status');
    if (ctx) { ctx.classList.toggle('connected',page!=='unsupported');ctx.textContent=status; }
    root.querySelectorAll<HTMLButtonElement>('[data-fill]').forEach(button=>{button.disabled=busy||page==='unsupported';});
  }
  function render() {
    root.innerHTML=`<div class="shell">
      <header class="brand"><span class="brand-mark">${icon('gift')}</span><div><span class="brand-name">GiftFill</span><span class="brand-subtitle">礼卡快填</span></div><span class="store-badge">US STORE</span></header>
      <div id="notice" class="notice" role="status" ${notice?'':'hidden'}>${e(notice)}</div>
      ${draft?renderEditor():renderProfiles()}
      <footer>${icon('lock')}<span>资料保存在此浏览器 · 填写后请核对</span><span class="version">v0.1.1</span></footer>
      <input id="import-file" type="file" accept=".json,application/json" hidden>
    </div>`;
    bindCommon();
    if (draft) bindEditor(); else bindProfiles();
    updateContext();
  }
  function renderProfiles():string {
    const cards=store.profiles.map(profile=>`<article class="profile-card ${profile.id===store.selectedId?'selected':''}">
      <button type="button" class="profile-select" data-select="${e(profile.id)}" aria-label="选择资料 ${e(profile.name)}" aria-pressed="${profile.id===store.selectedId}">
        <span class="profile-top"><span class="profile-name">${e(profile.name)}</span><span class="amount"><small>$</small>${e(profile.amount)}</span></span>
        <span class="profile-recipient">${e(profile.recipientEmail||'尚未填写收件邮箱')}</span>
        <span class="profile-meta">${e(profile.billingCountry)}${profile.city?' · '+e(profile.city):''}<span>${profile.id===store.selectedId?'已选用':'点击选用'}</span></span>
      </button>
      <div class="card-actions"><button class="fill-button" data-fill="${e(profile.id)}" type="button">${icon('arrow')}填写此页</button><button class="icon-button" data-edit="${e(profile.id)}" aria-label="编辑 ${e(profile.name)}" title="编辑资料">${icon('edit')}</button><button class="icon-button" data-copy="${e(profile.id)}" aria-label="复制 ${e(profile.name)}" title="复制资料">${icon('copy')}</button></div>
    </article>`).join('');
    return `<section class="connection"><span id="page-status" class="page-status"></span><button id="open-apple" class="text-button">打开购买页 ${icon('link')}</button></section>
      <div class="section-title"><div><h1>常用资料</h1><p>${store.profiles.length?'选一份资料，填好当前页面。':'把每次重复的信息，保存一次。'}</p></div><button id="new-profile" class="add-button" aria-label="新增资料">${icon('plus')}</button></div>
      ${store.profiles.length?`<div class="profile-list">${cards}</div><label class="overwrite"><input id="overwrite" type="checkbox" ${overwrites?'checked':''}><span>替换页面中已有的联系信息</span></label><p class="fill-hint">金额和账单国家按资料选择。${overwrites?'已有联系信息将被替换。':'已有联系信息会保留。'}</p>`:
        `<div class="empty-state"><span class="empty-graphic">${icon('gift')}</span><h2>下一次，少填一些</h2><p>金额、收发件邮箱、电话与账单地址，<br>都放进一份常用资料。</p><button id="first-profile" class="primary-button">${icon('plus')}创建第一份资料</button></div>`}
      ${renderResult()}
      <div class="data-toolbar"><button id="import" class="text-button">${icon('upload')}导入资料</button><button id="export" class="text-button" ${store.profiles.length?'':'disabled'}>${icon('download')}导出备份</button>${!isPreview?`<button id="manage" class="text-button">资料管理 ${icon('link')}</button>`:''}</div>
      <p class="backup-note" id="backup-note" hidden>备份包含邮箱、电话和地址，请妥善保存。</p>`;
  }
  function renderResult():string {
    if (!result && !busy) return '';
    if (busy) return `<section class="result-panel" aria-live="polite"><span class="spinner"></span><strong>正在填写并核对…</strong><p>等待页面字段准备好，请稍候。</p></section>`;
    if (result!.error) return `<section class="result-panel warning" aria-live="polite"><strong>需要处理一步</strong><p>${e(result!.error)}</p></section>`;
    const filled=result!.fields.filter(field=>field.status==='filled').length;
    const unfinished=result!.fields.filter(field=>field.status==='failed'||field.status==='missing').length;
    return `<section class="result-panel ${unfinished?'warning':'success'}" aria-live="polite"><div class="result-title">${icon(unfinished?'edit':'check')}<strong>已填写 ${filled} 项${unfinished?` · ${unfinished} 项待处理`:''}</strong></div><ul>${result!.fields.map(field=>`<li><span class="result-dot ${field.status}"></span><span>${e(field.label)}</span><span class="field-status">${{filled:'已核对',preserved:'已保留',missing:'未找到',failed:'请检查'}[field.status]}</span>${field.detail?`<small>${e(field.detail)}</small>`:''}</li>`).join('')}</ul><p>${result!.page==='giftcard'?'核对金额与邮箱后，在苹果页面继续购买。':'核对账单信息后，在苹果页面继续结账。'}</p></section>`;
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
      <section class="form-section"><div class="form-section-heading"><span class="step">03</span><h2>联系与账单</h2><button id="same-contact" type="button" class="text-button">使用发件邮箱</button></div><p class="section-help">按实际账单地址填写，商店地区固定为美区。</p>
        <div class="form-grid">${inputField('contactEmail',{type:'email',wide:true})}${inputField('phone',{type:'tel',wide:true,placeholder:'+1 …'})}
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
    root.querySelector('#open-apple')?.addEventListener('click',()=> {
      if(isPreview){window.open(APPLE_GIFTCARD_URL,'_blank','noopener');return;}
      void extension!.tabs.create({url:APPLE_GIFTCARD_URL});
    });
    root.querySelector('#overwrite')?.addEventListener('change',event=>{overwrites=(event.target as HTMLInputElement).checked;render();});
    root.querySelectorAll<HTMLButtonElement>('[data-select]').forEach(button=>button.addEventListener('click',async()=>{store.selectedId=button.dataset.select!;await persist();render();}));
    root.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach(button=>button.addEventListener('click',()=>edit(store.profiles.find(profile=>profile.id===button.dataset.edit))));
    root.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach(button=>button.addEventListener('click',()=>{const original=store.profiles.find(profile=>profile.id===button.dataset.copy)!;edit({...original,id:crypto.randomUUID(),name:original.name+' · 副本'});dirty=true;}));
    root.querySelectorAll<HTMLButtonElement>('[data-fill]').forEach(button=>button.addEventListener('click',()=>{void fill(button.dataset.fill!);}));
    root.querySelector('#import')?.addEventListener('click',()=>root.querySelector<HTMLInputElement>('#import-file')!.click());
    root.querySelector('#export')?.addEventListener('click',()=> {
      const backup={app:'giftfill',version:1,exportedAt:new Date().toISOString(),profiles:store.profiles};
      const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download=`giftfill-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      root.querySelector<HTMLElement>('#backup-note')!.hidden=false;showNotice('备份已导出，内含联系资料，请妥善保存');
    });
    root.querySelector('#manage')?.addEventListener('click',()=>{void extension!.runtime.openOptionsPage();});
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
    root.querySelector('#same-contact')!.addEventListener('click',()=>{readDraft();draft!.contactEmail=draft!.senderEmail;dirty=true;render();});
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
        store.selectedId=draft!.id;await persist();draft=null;dirty=false;result=null;showNotice('资料已保存');render();
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
  async function fill(id:string) {
    if(busy||isPreview)return;
    await refreshPage();if(page==='unsupported'||tabId===undefined){showNotice('请先切换到苹果购买页或结账页');return;}
    const profile=store.profiles.find(item=>item.id===id);if(!profile)return;
    busy=true;result=null;store.selectedId=id;
    const target=tabId;
    try{await persist();render();result=await extension!.tabs.sendMessage(target,{type:'GIFTFILL_FILL',profile,overwrite:overwrites});}
    catch{result={page,fields:[],error:'页面尚未连接。安装或更新扩展后，请刷新苹果页面再试。'};}
    finally{busy=false;render();}
  }
  render();await refreshPage();
  watchStore(()=>{if(!draft&&!busy)void loadStore().then(updated=>{store=updated;render();});});
  if(!isPreview){
    extension!.tabs.onActivated.addListener(()=>{void refreshPage();});
    extension!.tabs.onUpdated.addListener((_id,change)=>{if(change.url||change.status==='complete')void refreshPage();});
  }
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();}});
}
