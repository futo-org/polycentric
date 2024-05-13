import legacy from '@vitejs/plugin-legacy'
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    legacy()
  ]
})
