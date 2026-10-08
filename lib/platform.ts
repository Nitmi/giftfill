import type { browser } from 'wxt/browser';
type ExtensionApi = typeof browser;
export const extension = (globalThis as typeof globalThis & { chrome?: ExtensionApi }).chrome;
export const isPreview = !extension?.runtime?.id;
