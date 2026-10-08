export const PROFILE_FIELDS = [
  'name', 'amount', 'recipientName', 'recipientEmail', 'senderName', 'senderEmail',
  'contactEmail', 'phone', 'billingCountry', 'firstName', 'lastName', 'street',
  'street2', 'city', 'state', 'district', 'postalCode',
] as const;
export type ProfileField = typeof PROFILE_FIELDS[number];
export type Profile = Record<ProfileField, string> & { id: string; updatedAt: string };
export interface ProfileStore { version: 1; profiles: Profile[]; selectedId: string | null }

export function newProfile(): Profile {
  return {
    id: crypto.randomUUID(), updatedAt: new Date().toISOString(), name: '', amount: '20',
    recipientName: '', recipientEmail: '', senderName: '', senderEmail: '', contactEmail: '',
    phone: '', billingCountry: 'US', firstName: '', lastName: '', street: '', street2: '',
    city: '', state: '', district: '', postalCode: '',
  };
}

const emailFields: ProfileField[] = ['recipientEmail', 'senderEmail', 'contactEmail'];
export function validateProfile(profile: Profile): Partial<Record<ProfileField, string>> {
  const errors: Partial<Record<ProfileField, string>> = {};
  if (!profile.name.trim()) errors.name = '给这份资料起一个名字';
  if (!/^\d+(\.\d{1,2})?$/.test(profile.amount) || Number(profile.amount) < 10 || Number(profile.amount) > 2000) {
    errors.amount = '请输入 $10–$2,000 的金额，最多两位小数';
  }
  for (const key of emailFields) {
    if (profile[key] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile[key])) errors[key] = '请检查邮箱格式';
  }
  if (!['US', 'CN', 'HK', 'JP', 'CA', 'GB', 'AU', 'SG', 'TW', 'DE', 'FR'].includes(profile.billingCountry)) {
    errors.billingCountry = '请选择账单国家或地区';
  }
  if (profile.billingCountry === 'US' && profile.postalCode && !/^\d{5}(-\d{4})?$/.test(profile.postalCode)) {
    errors.postalCode = '美国 ZIP 为 5 位数字，可附加 4 位扩展码';
  }
  if (profile.phone && !/^[+\d\s().-]{5,30}$/.test(profile.phone)) errors.phone = '请检查电话号码格式';
  return errors;
}

export function parseProfile(value: unknown): Profile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('资料格式不正确');
  const input = value as Record<string, unknown>;
  const profile = newProfile();
  for (const key of PROFILE_FIELDS) {
    if (typeof input[key] !== 'string' || input[key].length > 500) throw new Error('资料字段缺失或过长');
    profile[key] = input[key].trim();
  }
  if (typeof input.id === 'string' && /^[\w-]{1,80}$/.test(input.id)) profile.id = input.id;
  if (Object.keys(validateProfile(profile)).length) throw new Error('资料中有无效金额、邮箱或地址格式');
  return profile;
}

export function parseImport(text: string): Profile[] {
  if (text.length > 1_000_000) throw new Error('导入文件过大，请选择小于 1 MB 的资料文件');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('文件不是有效的 JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请选择 GiftFill 导出的资料文件');
  const data = parsed as Record<string, unknown>;
  if (data.app !== 'giftfill' || data.version !== 1 || !Array.isArray(data.profiles) || data.profiles.length > 100) {
    throw new Error('请选择 GiftFill v1 资料文件，每次最多导入 100 份');
  }
  return data.profiles.map(item => ({ ...parseProfile(item), id: crypto.randomUUID() }));
}

export function emptyStore(): ProfileStore { return { version: 1, profiles: [], selectedId: null }; }
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
