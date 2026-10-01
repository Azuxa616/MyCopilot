import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [
        {
            // vitest 不加载 vite.config.ts 的 vite-plugin-svgr，*.svg?react 会解析为
            // data-URL 字符串；渲染它的测试会抛 InvalidCharacterError。
            // 测试中图标无断言价值，统一桩为空组件。
            name: 'svg-react-stub',
            enforce: 'pre',
            resolveId(id) {
                if (id.endsWith('.svg?react')) return '\0svg-react-stub';
                return null;
            },
            load(id) {
                if (id === '\0svg-react-stub') {
                    return 'export default function SvgStub() { return null }';
                }
                return null;
            },
        },
    ],
    test: {
        environment: 'jsdom',
        include: ['src/**/*.test.{ts,tsx}'],
    },
});
