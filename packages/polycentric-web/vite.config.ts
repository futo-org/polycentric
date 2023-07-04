import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["@polycentric/polycentric-react"]
  }
  // Currently not using tailwindcss because it's prepackaged with polycentric-react
})
