import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit tests for framework-independent logic (utils). Browser flows are covered by Playwright.
export default defineConfig({
  resolve: { alias: { '~': fileURLToPath(new URL('./app', import.meta.url)) } },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' }
})
