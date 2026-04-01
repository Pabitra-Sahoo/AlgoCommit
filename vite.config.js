import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'index.html'),
        background: resolve(__dirname, 'src/background/background.js'),
        'content-leetcode': resolve(__dirname, 'src/content_scripts/leetcode.js'),
        'content-gfg': resolve(__dirname, 'src/content_scripts/geeksforgeeks.js'),
        'content-codeforces': resolve(__dirname, 'src/content_scripts/codeforces.js'),
        'github-utils': resolve(__dirname, 'src/utils/github.js')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash].[ext]'
      }
    }
  }
})
