import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  // 注意：在 Tailwind CSS v4 中，主题定义应该在 CSS 文件中使用 @theme 指令
  // 配置文件主要用于指定内容路径和其他配置
}

export default config

