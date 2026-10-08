import { describe,it,expect,vi,afterEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createVault,unlockVault,sealVault,parseCard,VaultSession,VAULT_IDLE_MS } from '../lib/vault';
vi.stubGlobal('crypto',webcrypto);
afterEach(()=>vi.restoreAllMocks());
const testCard=()=>parseCard({id:'card-one',name:'Test Visa',number:'4111 1111 1111 1111',expiry:'12/29',cvv:'123'});
describe('local payment vault',()=>{
  it('persists authenticated ciphertext with unique IVs and a non-exportable key',async()=>{
    const created=await createVault('a-long-test-passphrase');
    const data={cards:[testCard()],bindings:{profileOne:'card-one'}};
    const first=await sealVault(data,created.key,created.encrypted.salt);
    const second=await sealVault(data,created.key,created.encrypted.salt);
    expect(first.iv).not.toBe(second.iv);expect(created.key.extractable).toBe(false);
    expect(JSON.stringify(first)).not.toContain('4111111111111111');expect(JSON.stringify(first)).not.toContain('a-long-test-passphrase');
    const opened=await unlockVault(first,'a-long-test-passphrase');expect(opened.data).toEqual(data);
    expect(opened.data.cards[0]).not.toHaveProperty('cvv');
  });
  it('rejects a wrong password, changed ciphertext, and hostile KDF settings',async()=>{
    const created=await createVault('another-long-test-password');
    await expect(unlockVault(created.encrypted,'incorrect-password')).rejects.toThrow('解锁失败');
    const raw=Uint8Array.from(atob(created.encrypted.data),char=>char.charCodeAt(0));raw[0]!^=1;
    await expect(unlockVault({...created.encrypted,data:btoa(String.fromCharCode(...raw))},'another-long-test-password')).rejects.toThrow('解锁失败');
    await expect(unlockVault({...created.encrypted,iterations:1},'another-long-test-password')).rejects.toThrow('不支持');
    await expect(createVault('short')).rejects.toThrow('12');
  });
  it('locks on expiry and never returns a card after locking',async()=>{
    const created=await createVault('session-test-password');
    const session=new VaultSession();const card=testCard();
    session.set(created.key,{cards:[card],bindings:{profileOne:card.id}},created.encrypted.salt);
    expect(session.card('profileOne')?.number).toBe(card.number);
    const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+VAULT_IDLE_MS+1);
    expect(session.card('profileOne')).toBeUndefined();expect(session.snapshot).toBeNull();
    await expect(session.seal({cards:[],bindings:{}})).rejects.toThrow('解锁');
  });
  it('validates card checksum, expiry and explicitly strips extra secret fields',()=>{
    expect(testCard()).not.toHaveProperty('cvv');
    expect(()=>parseCard({name:'Wrong',number:'4111111111111112',expiry:'12/29'})).toThrow('校验');
    expect(()=>parseCard({name:'Expired',number:'4111111111111111',expiry:'01/20'})).toThrow('过期');
  });
});
