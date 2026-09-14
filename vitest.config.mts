import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: {
    '@': fileURLToPath(new URL('./src', import.meta.url)),
    'server-only': fileURLToPath(new URL('./src/lib/talent-bank/__tests__/server-only.ts', import.meta.url)),
  } },
  test: {
    environment: 'node', include: ['src/lib/**/__tests__/*.test.ts'],
    setupFiles: ['./src/lib/talent-bank/__tests__/setup.ts'],
    clearMocks: true, restoreMocks: true,
  },
})
