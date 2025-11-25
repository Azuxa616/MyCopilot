import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import svgr from 'vite-plugin-svgr'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    svgr({
      svgrOptions: {
        exportType: 'default',
      },
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // 将React相关库打包在一起
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'react-vendor'
          }
          // 将UI库打包在一起
          if (id.includes('@tanstack/react-virtual') || id.includes('react-markdown') || id.includes('prismjs')) {
            return 'ui-vendor'
          }
          // 将工具库打包在一起
          if (id.includes('zustand') || id.includes('eventsource-parser') || id.includes('remark-gfm') || id.includes('rehype-raw') || id.includes('rehype-prism-plus')) {
            return 'utils-vendor'
          }
        }
      }
    },
    // 增加chunk大小警告限制
    chunkSizeWarningLimit: 1000
  }
})
