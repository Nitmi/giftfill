// Only ciphertext is persistent. Keys and decrypted cards live in the panel's memory.
export interface PaymentCard { id:string; name:string; number:string; expiry:string }
export interface VaultData { cards:PaymentCard[]; bindings:Record<string,string> }
export interface EncryptedVault { version:1; iterations:600000; salt:string; iv:string; data:string }
export const VAULT_IDLE_MS=5*60*1000;
const encoder=new TextEncoder();
const aad=encoder.encode('giftfill.payment-vault.v1');
function base64(bytes:Uint8Array):string { return btoa(String.fromCharCode(...bytes)); }
function bytes(text:string):Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(text),char=>char.charCodeAt(0)); }

export function parseCard(input:unknown, now=new Date()):PaymentCard {
  if(!input||typeof input!=='object')throw new Error('卡片格式不正确');
  const card=input as Record<string,unknown>;
  if(typeof card.number!=='string'||typeof card.expiry!=='string'||typeof card.name!=='string')throw new Error('卡片字段缺失');
  const number=card.number.replace(/[ -]/g,'');
  if(!/^\d{12,19}$/.test(number))throw new Error('请检查卡号长度和数字');
  let sum=0;let double=false;
  for(let i=number.length-1;i>=0;i--){let digit=Number(number[i]);if(double){digit*=2;if(digit>9)digit-=9;}sum+=digit;double=!double;}
  if(sum%10!==0||/^0+$/.test(number))throw new Error('卡号校验未通过，请核对');
  const match=card.expiry.trim().match(/^(0?[1-9]|1[0-2])\s*\/\s*(\d{2}|\d{4})$/);
  if(!match)throw new Error('有效期格式为 MM/YY');
  const month=Number(match[1]);const year=Number(match[2])+(match[2]!.length===2?2000:0);
  if(year<now.getFullYear()||(year===now.getFullYear()&&month<now.getMonth()+1)||year>now.getFullYear()+30)throw new Error('请检查有效期是否已过期');
  const name=card.name.trim();if(!name||name.length>80)throw new Error('请输入 1–80 字的卡片昵称');
  return {id:typeof card.id==='string'&&/^[\w-]{1,80}$/.test(card.id)?card.id:crypto.randomUUID(),name,number,expiry:`${String(month).padStart(2,'0')}/${String(year).slice(-2)}`};
}
function parseData(value:unknown):VaultData {
  if(!value||typeof value!=='object')throw new Error('卡库格式不正确');
  const data=value as Record<string,unknown>;
  if(!Array.isArray(data.cards)||data.cards.length>30||!data.bindings||typeof data.bindings!=='object'||Array.isArray(data.bindings))throw new Error('卡库格式不正确');
  // Permit expired cards in an unlocked vault so they can still be removed.
  const cards=data.cards.map(input=>parseCard(input,new Date('2020-01-01')));
  if(new Set(cards.map(card=>card.id)).size!==cards.length)throw new Error('卡库包含重复卡片');
  const bindings:Record<string,string>={};
  for(const [id,cardId] of Object.entries(data.bindings))if(/^[\w-]{1,80}$/.test(id)&&typeof cardId==='string'&&cards.some(card=>card.id===cardId))bindings[id]=cardId;
  return {cards,bindings};
}
function parseEncrypted(value:unknown):EncryptedVault {
  if(!value||typeof value!=='object')throw new Error('卡库数据损坏');
  const v=value as EncryptedVault;
  if(v.version!==1||v.iterations!==600000||typeof v.salt!=='string'||typeof v.iv!=='string'||typeof v.data!=='string'||v.data.length>100000)throw new Error('不支持的卡库格式');
  if(bytes(v.salt).length!==16||bytes(v.iv).length!==12||bytes(v.data).length<16)throw new Error('卡库数据损坏');
  return v;
}
async function derive(password:string,salt:Uint8Array<ArrayBuffer>):Promise<CryptoKey> {
  const raw=encoder.encode(password);
  try {
    const material=await crypto.subtle.importKey('raw',raw,'PBKDF2',false,['deriveKey']);
    return await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:600000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  } finally {raw.fill(0);}
}
export async function sealVault(data:VaultData,key:CryptoKey,salt:string):Promise<EncryptedVault> {
  const iv=crypto.getRandomValues(new Uint8Array(12));const raw=encoder.encode(JSON.stringify(data));
  try {
    const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},key,raw);
    return {version:1,iterations:600000,salt,iv:base64(iv),data:base64(new Uint8Array(encrypted))};
  } finally {raw.fill(0);}
}
export async function createVault(password:string):Promise<{key:CryptoKey; encrypted:EncryptedVault; data:VaultData}> {
  if(password.length<12||password.length>256)throw new Error('请使用 12–256 字符的独立解锁口令');
  const salt=base64(crypto.getRandomValues(new Uint8Array(16)));const key=await derive(password,bytes(salt));
  const data:VaultData={cards:[],bindings:{}};
  return {key,data,encrypted:await sealVault(data,key,salt)};
}
export async function unlockVault(value:unknown,password:string):Promise<{key:CryptoKey; data:VaultData}> {
  const encrypted=parseEncrypted(value);
  if(password.length>256)throw new Error('解锁口令过长');
  const key=await derive(password,bytes(encrypted.salt));
  let raw:ArrayBuffer;
  try {raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(encrypted.iv),additionalData:aad,tagLength:128},key,bytes(encrypted.data));}
  catch {throw new Error('解锁失败：口令不正确或卡库数据损坏');}
  try {return {key,data:parseData(JSON.parse(new TextDecoder().decode(raw)))};}
  finally {new Uint8Array(raw).fill(0);}
}
export class VaultSession {
  private key:CryptoKey|null=null;
  private data:VaultData|null=null;
  private salt='';
  private expires=0;
  set(key:CryptoKey,data:VaultData,salt:string){this.lock();this.key=key;this.data=data;this.salt=salt;this.touch();}
  get unlocked(){if(this.expires<=Date.now())this.lock();return !!this.key;}
  get snapshot():VaultData|null {return this.unlocked?this.data:null;}
  touch(){if(this.key)this.expires=Date.now()+VAULT_IDLE_MS;}
  lock(){this.key=null;this.data=null;this.salt='';this.expires=0;}
  card(profileId:string):PaymentCard|undefined {const data=this.snapshot;const found=data?.cards.find(card=>card.id===data.bindings[profileId]);if(!found)return;this.touch();return parseCard(found);}
  async seal(data:VaultData):Promise<EncryptedVault>{if(!this.unlocked)throw new Error('请先解锁卡库');return sealVault(data,this.key!,this.salt);}
  accept(data:VaultData){if(!this.unlocked)throw new Error('卡库已自动锁定，请重新解锁');this.data=data;this.touch();}
}
