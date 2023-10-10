import libAssetsPlugin from '@laynezh/vite-plugin-lib-assets'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import tailwindcss from 'tailwindcss'
import unfonts from 'unplugin-fonts/vite'
import dts from 'vite-plugin-dts'
import { defineConfig } from 'vitest/config'
import { name } from './package.json'

const app = defineConfig(({ mode }) => ({
  plugins: [
    react(),
    dts({
      insertTypesEntry: true,
    }),
    unfonts({
      fontsource: {
        families: [
          { name: 'Public Sans', weights: [100, 200, 300, 400, 500, 600, 700, 800, 900] },
          { name: 'Fragment Mono', weights: [400] },
        ],
      },
    }),
    libAssetsPlugin({
      // limit: 1024 * 8,
    }),
  ],
  css: {
    postcss: {
      plugins: [tailwindcss],
    },
  },
  optimizeDeps: {
    exclude: mode === 'development' ? ['@polycentric/polycentric-core'] : [],
  },
  build: {
    sourcemap: mode === 'development',
    emptyOutDir: false,
    lib: {
      name,
      entry: path.resolve(__dirname, 'src/lib/index.ts'),
      formats: ['es', 'umd'],
      fileName: (format) => `polycentric-react.${format}.js`,
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'tailwindcss', '@polycentric/polycentric-core'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          tailwindcss: 'tailwindcss',
          'react/jsx-runtime': 'react/jsx-runtime',
          '@polycentric/polycentric-core': '@polycentric/polycentric-core',
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
