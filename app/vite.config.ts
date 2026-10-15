import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// base './' keeps all asset URLs relative, so app/dist works on any static host
// (GitHub Pages project sites, a local file server, ...).
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
  },
})
