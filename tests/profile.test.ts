import { describe, expect, it } from 'vitest';
import { newProfile, parseImport, parseProfile, validateProfile } from '../lib/profile';
import { classifyPage } from '../lib/page';

describe('profile boundaries',()=>{
  it('rejects out-of-range amounts and invalid email/ZIP data',()=>{
    const profile={...newProfile(),name:'Test',amount:'2000.01',recipientEmail:'not-an-email',postalCode:'ABCDE'};
    expect(Object.keys(validateProfile(profile))).toEqual(expect.arrayContaining(['amount','recipientEmail','postalCode']));
    expect(validateProfile({...profile,amount:'20.50',recipientEmail:'test@example.com',postalCode:'95014'})).toEqual({});
  });
  it('imports copies without accepting payment fields or script metadata',()=>{
    const profile={...newProfile(),name:'Test',cardNumber:'SHOULD-NOT-IMPORT',script:'alert(1)'};
    const [copy]=parseImport(JSON.stringify({app:'giftfill',version:1,profiles:[profile]}));
    expect(copy?.id).not.toBe(profile.id);
    expect(copy).not.toHaveProperty('cardNumber');
    expect(copy).not.toHaveProperty('script');
    expect(()=>parseProfile({...profile,amount:'-10'})).toThrow();
    expect(()=>parseImport(JSON.stringify({app:'other',version:1,profiles:[profile]}))).toThrow();
  });
  it('only targets the US Apple purchase and secure Apple checkout URLs',()=>{
    expect(classifyPage('https://www.apple.com/shop/buy-giftcard/giftcard/25-dollars')).toBe('giftcard');
    expect(classifyPage('https://secure7.store.apple.com/shop/checkout?_s=abc')).toBe('checkout');
    for(const url of ['https://www.apple.com.evil.test/shop/buy-giftcard/giftcard','https://evil.test/store.apple.com/shop/checkout','http://www.apple.com/shop/buy-giftcard/giftcard','https://www.apple.com/jp/shop/buy-giftcard/giftcard','https://www.apple.com/shop/buy-iphone/iphone']) expect(classifyPage(url)).toBe('unsupported');
  });
});
