import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import tailwindcss from 'tailwindcss'
import { UserConfigExport } from 'vite'
import unfonts from 'unplugin-fonts/vite'

const app = async (): Promise<UserConfigExport> => {
  return defineConfig({
    plugins: [
      react(),
      unfonts({
        fontsource:
        {
          families: [
            { name: 'Public Sans', weights: [100, 200, 300, 400, 500, 600, 700, 800, 900] },
            { name: 'Fragment Mono', weights: [400] },
          ]
        }
      })
    ],
    css: {
      postcss: {
        plugins: [tailwindcss],
      },
    },
  })
}
// https://vitejs.dev/config/
export default app
