import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: { include: ['src/tests/**/*.test.{ts,tsx}'], environment: 'jsdom', setupFiles: ['./src/tests/setup.ts'], css: true, coverage: { reporter: ['text', 'html'] } },
})
