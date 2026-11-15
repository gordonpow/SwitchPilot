import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/global-setup.ts'],
    // 會 spawn node／腳本的測試在全套平行執行時可能超過預設 5 秒
    testTimeout: 20000
  }
})
