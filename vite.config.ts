import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the prebuilt dist/ also works when opened
  // directly from disk (file://) with no server.
  base: './',
})
