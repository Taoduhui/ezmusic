import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
const host = process.env.TAURI_DEV_HOST;
const isTauriBuild = process.env.TAURI_ENV_PLATFORM != null;

export default defineConfig(({ command }) => ({
  base: command === 'build' ? (isTauriBuild ? './' : '/ezmusic/') : '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Generate PWA icons from the existing favicon SVG
      pwaAssets: {
        image: 'public/favicon.svg',
        preset: 'minimal-2023',
      },
      manifest: {
        name: '音乐训练',
        short_name: '音乐训练',
        description: '音乐训练 · 音程速算、识谱速训、音程速训',
        theme_color: '#080b12',
        background_color: '#080b12',
        display: 'standalone',
        lang: 'zh-CN',
        categories: ['education', 'music'],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // 4 MiB
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            // Cache audio samples (piano notes) with cache-first strategy
            urlPattern: /\/audio\/.*\.mp3$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'audio-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
            },
          },
          {
            // Google Fonts stylesheets
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
            },
          },
          {
            // Google Fonts webfont files
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
            },
          },
        ],
      },
    }),
  ],
  optimizeDeps: {
    exclude: [
      '@ezmusic/shared',
      '@ezmusic/chapter-note-solfege',
      '@ezmusic/chapter-staff-notation',
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
    // Tauri Android dev 需要监听 0.0.0.0，否则设备无法通过局域网连接 dev server
    host: host || '0.0.0.0',
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: (process.env.TAURI_ENV_PLATFORM === 'windows' || process.env.TAURI_ENV_PLATFORM === 'android') ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
}));
