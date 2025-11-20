import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 主色调 - 温和的蓝色系
        primary: {
          50: '#E8F2F8',
          100: '#D1E5F1',
          200: '#A3CBE3',
          300: '#75B1D5',
          400: '#5B9BD5',
          500: '#4A90E2',
          600: '#3A7BC8',
          700: '#2E66A3',
          800: '#22517E',
          900: '#163C59',
          950: '#0B1F2D',
        },
        // 背景色
        bg: {
          primary: '#FAF9F6',
          secondary: '#F5F5F0',
          tertiary: '#EFEFEA',
          elevated: '#FFFFFF',
          hover: '#F0F0EB',
        },
        // 文字颜色
        text: {
          primary: '#2C3E50',
          secondary: '#5A6C7D',
          tertiary: '#8B9AAB',
          disabled: '#BDC3C7',
          inverse: '#FFFFFF',
        },
        // 边框颜色
        border: {
          light: '#E5E5E5',
          base: '#D5D5D0',
          dark: '#C5C5C0',
        },
        // 功能色
        success: {
          DEFAULT: '#52C41A',
          light: '#B7EB8F',
          dark: '#389E0D',
        },
        warning: {
          DEFAULT: '#FAAD14',
          light: '#FFE58F',
          dark: '#D48806',
        },
        error: {
          DEFAULT: '#FF4D4F',
          light: '#FFCCC7',
          dark: '#CF1322',
        },
        info: {
          DEFAULT: '#4A90E2',
          light: '#BAE7FF',
          dark: '#096DD9',
        },
      },
      backgroundColor: {
        'primary': '#FAF9F6',
        'secondary': '#F5F5F0',
        'tertiary': '#EFEFEA',
        'elevated': '#FFFFFF',
        'hover': '#F0F0EB',
      },
      textColor: {
        'primary': '#2C3E50',
        'secondary': '#5A6C7D',
        'tertiary': '#8B9AAB',
        'disabled': '#BDC3C7',
        'inverse': '#FFFFFF',
      },
      borderColor: {
        'light': '#E5E5E5',
        'base': '#D5D5D0',
        'dark': '#C5C5C0',
      },
    },
  },
  plugins: [],
}

export default config

