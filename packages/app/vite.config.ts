import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/ezmusic/' : '/',
  plugins: [react()],
  optimizeDeps: {
    exclude: [
      '@ezmusic/shared',
      '@ezmusic/chapter-note-solfege',
      '@ezmusic/chapter-staff-notation',
    ],
  },
  server: {
    port: 5173,
  },
}));
