import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import { VitePWA } from 'vite-plugin-pwa';

const polycentricDeps = [
    '@polycentric/polycentric-core',
    '@polycentric/polycentric-react',
];

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
    server: { https: true },
    plugins: [
        react(),
        mkcert(),
        VitePWA({
            registerType: 'autoUpdate',
            devOptions: {
                enabled: true,
            },
            manifest: {
                name: 'Polycentric',
                short_name: 'Polycentric',
                theme_color: '#ffffff',
                background_color: '#ffffff',
                display: 'standalone',
                orientation: 'portrait',
                scope: '/',
                start_url: '/',
                icons: [
                    {
                        src: '/icons/favicon.ico',
                        sizes: '64x64',
                        type: 'image/x-icon',
                    },
                    {
                        src: '/icons/icon_x192.png',
                        sizes: '192x192',
                        type: 'image/png',
                        purpose: 'any',
                    },
                    {
                        src: '/icons/maskable_icon_x48.png',
                        sizes: '48x48',
                        type: 'image/png',
                        purpose: 'maskable',
                    },
                    {
                        src: '/icons/maskable_icon_x72.png',
                        sizes: '72x72',
                        type: 'image/png',
                        purpose: 'maskable',
                    },
                    {
                        src: '/icons/maskable_icon_x96.png',
                        sizes: '96x96',
                        type: 'image/png',
                        purpose: 'maskable',
                    },
                    {
                        src: '/icons/maskable_icon_x128.png',
                        sizes: '128x128',
                        type: 'image/png',
                        purpose: 'maskable',
                    },
                    {
                        src: '/icons/maskable_icon_x192.png',
                        sizes: '192x192',
                        type: 'image/png',
                        purpose: 'maskable',
                    },
                    {
                        src: '/icons/maskable_icon_x384.png',
                        sizes: '384x384',
                        type: 'image/png',
                        purpose: 'maskable',
                    },
                    {
                        src: '/icons/maskable_icon_x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'maskable',
                    },
                ],
            },
        }),
    ],
    build: {
        rollupOptions: {
            external: command === 'serve' ? polycentricDeps : [],
            output: {
                format: 'es',
                manualChunks: {
                    react: ['react'],
                    'react-dom': ['react-dom'],
                    '@polycentric/polycentric-core': [
                        '@polycentric/polycentric-core',
                    ],
                    '@polycentric/polycentric-react': [
                        '@polycentric/polycentric-react',
                    ],
                },
            },
        },
    },
    optimizeDeps: {
        exclude: command === 'serve' ? polycentricDeps : [],
    },
    // Currently not using tailwindcss because it's prepackaged with polycentric-react
}));
