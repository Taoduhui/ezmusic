import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const [repositoryOwner, repositoryNameFromEnv, ...extraRepositoryParts] = (
  process.env.GITHUB_REPOSITORY ?? ''
).split('/');
const repositoryName =
  repositoryOwner && repositoryNameFromEnv && extraRepositoryParts.length === 0
    ? repositoryNameFromEnv
    : undefined;
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
