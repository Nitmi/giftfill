import { extension, isPreview } from './platform';
import { emptyStore, type ProfileStore } from './profile';

const KEY = 'giftfill.profiles.v1';
const LEGACY_PAYMENT_KEY = 'giftfill.payment-vault.v1';
export async function loadStore(): Promise<ProfileStore> {
  if (isPreview) {
    localStorage.removeItem(LEGACY_PAYMENT_KEY);
    const stored = localStorage.getItem(KEY);
    return stored ? JSON.parse(stored) as ProfileStore : emptyStore();
  }
  await extension!.storage.local.remove(LEGACY_PAYMENT_KEY);
  const stored = await extension!.storage.local.get(KEY);
  return (stored[KEY] as ProfileStore | undefined) ?? emptyStore();
}
export async function saveStore(store: ProfileStore): Promise<void> {
  if (isPreview) localStorage.setItem(KEY, JSON.stringify(store));
  else await extension!.storage.local.set({ [KEY]: store });
}
export function watchStore(callback: () => void): void {
  if (isPreview) window.addEventListener('storage', e => { if (e.key === KEY) callback(); });
  else extension!.storage.onChanged.addListener((changes, area) => { if (area === 'local' && KEY in changes) callback(); });
}
