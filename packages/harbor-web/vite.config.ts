import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3001,
    https: {
      key: '../../devcert/local-key.pem',
      cert: '../../devcert/local-cert.pem',
    },
  },
  plugins: [react()],
});
