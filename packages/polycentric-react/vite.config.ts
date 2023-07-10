import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vitest/config'
import dts from 'vite-plugin-dts'
import tailwindcss from 'tailwindcss'
import { UserConfigExport } from 'vite'
import { name } from './package.json'

const app = defineConfig(({ mode }) => ({
  plugins: [
    react(),
    dts({
      insertTypesEntry: true,
    }),
  ],
  css: {
    postcss: {
      plugins: [tailwindcss],
    },
  },
  optimizeDeps: {
    exclude: mode === 'development' ? ["@polycentric/polycentric-core"] : [],
  },
  build: {
    sourcemap: mode === 'development',
    lib: {
      entry: path.resolve(__dirname, 'src/lib/index.ts'),
      name,
      formats: ['es', 'umd'],
      fileName: (format) => `polycentric-react.${format}.js`,
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'tailwindcss', "@polycentric/polycentric-core"],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          tailwindcss: 'tailwindcss',
          'react/jsx-runtime': 'react/jsx-runtime',
          "@polycentric/polycentric-core": "@polycentric/polycentric-core",
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
  },
}))

// https://vitejs.dev/config/
export default app