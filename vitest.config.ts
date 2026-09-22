import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { buildInfo } from './build-info'

export default defineConfig({
  plugins: [react()],
  define: buildInfo(),
  test: { include: ['src/tests/**/*.test.{ts,tsx}'], environment: 'jsdom', setupFiles: ['./src/tests/setup.ts'], css: true, coverage: { reporter: ['text', 'html'] } },
})
