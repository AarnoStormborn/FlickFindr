import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**'],
      exclude: ['src/main.jsx', 'src/test/**'],
      // Ratchet: just below current numbers so coverage cannot silently regress.
      thresholds: { lines: 58, statements: 55, functions: 48, branches: 40 },
    },
    include: ['src/**/*.test.{js,jsx}'],
    css: false, // CSS is imported by components; skip processing in tests
    restoreMocks: true,
  },
})
