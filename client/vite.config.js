import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: client on 5173, API proxied to the Express server on 3001.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
