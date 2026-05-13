import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: [
      '@ezmusic/shared',
      '@ezmusic/chapter-prologue',
      '@ezmusic/chapter-listening',
      '@ezmusic/ear-trainer',
    ],
  },
  server: {
    port: 5173,
  },
});
