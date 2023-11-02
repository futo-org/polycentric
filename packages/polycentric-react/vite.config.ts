import libAssetsPlugin from '@laynezh/vite-plugin-lib-assets'
import react from '@vitejs/plugin-react-swc'
import path from 'node:path'
import tailwindcss from 'tailwindcss'
import dts from 'vite-plugin-dts'
import { defineConfig } from 'vitest/config'
import { name } from './package.json'

const app = defineConfig(({ mode }) => ({
  plugins: [
    react(),
    dts({
      insertTypesEntry: true,
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
