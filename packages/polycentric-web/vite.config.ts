import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const polycentricDeps = ['@polycentric/polycentric-core', '@polycentric/polycentric-react'];

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  build: {
    rollupOptions: {
      external: command === 'serve' ? polycentricDeps : [],
    }
  },
  optimizeDeps: {
    exclude: command === 'serve' ? polycentricDeps : [],
  },
  // Currently not using tailwindcss because it's prepackaged with polycentric-react
}))
