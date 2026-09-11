import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // getUserMedia requires a secure context. localhost counts as secure,
    // so plain http on localhost is fine. Only matters if you demo over LAN IP.
    host: true,
  },
});
