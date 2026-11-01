import { defineConfig, type Plugin } from 'vitest/config';

// vitest.config.ts 优先于 vite.config.ts，svgr 不会在测试中生效；
// 缺少此桩时 *.svg?react 退化为 data-URL 字符串，渲染抛 InvalidCharacterError。勿删（见 .agents/skills/svg-icons）。
function svgReactStub(): Plugin {
  return {
    name: 'svg-react-stub',
    enforce: 'pre',
    load(id) {
      if (/\.svg\?react/.test(id)) {
        return 'export default function SvgIconStub() { return null; }';
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [svgReactStub()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
