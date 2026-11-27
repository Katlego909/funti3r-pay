import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The admin console: its own origin (port 3200), so its session never mixes with the dashboard's on 3100.
export default defineConfig({
  plugins: [react()],
  server: { port: 3200, strictPort: true },
});
