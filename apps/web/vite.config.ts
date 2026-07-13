import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import svgr from 'vite-plugin-svgr'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { generateBuildInfo } from '../../scripts/generate-build-info.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BUILD_INFO_OUTPUT = resolve(__dirname, 'src/build-info.generated.json')

/**
 * Inline Vite plugin that (re)generates git build metadata into
 * `src/build-info.generated.json` so the debug panel can surface branch /
 * commit info in both dev and production builds. Generation is fail-soft (the
 * underlying script never throws) so this can never break a build.
 *
 * - `configureServer`: fires on `vite dev` start → fresh git info at boot.
 * - `closeBundle`: fires at the end of `vite build` → baked into the bundle.
 */
function buildInfoPlugin(): Plugin {
  const regenerate = () => {
    try {
      generateBuildInfo(BUILD_INFO_OUTPUT)
    } catch {
      // generateBuildInfo is already fail-soft; this guard is belt-and-suspenders
      // to guarantee a filesystem error can never abort dev/build.
    }
  }
  return {
    name: 'my-copilot-build-info',
    configureServer() {
      regenerate()
    },
    closeBundle() {
      regenerate()
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    svgr({
      svgrOptions: {
        exportType: 'default',
      },
    }),
    buildInfoPlugin(),
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
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  }
})
