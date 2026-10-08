import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'], testTimeout: 15000 },
});
