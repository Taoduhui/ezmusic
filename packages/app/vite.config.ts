import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const githubPagesBase = repositoryName ? `/${repositoryName}/` : '/';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS === 'true' ? githubPagesBase : '/',
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
