# MyCopilot AI 对话应用Demo

<div align="center">
  <h1>MyCopilot</h1>
  <p>🚀 纯前端实现的现代化 AI 对话应用Demo，基于 React + TypeScript 构建</p>
  <p>✨ 支持流式响应、Markdown 渲染、历史会话管理等完整功能</p>
</div>

---

## 📋 项目简介

MyCopilot 是一个功能完整的 AI 对话应用 Demo，采用现代前端技术栈构建，提供了流畅的对话体验和丰富的交互功能。项目实现了完整的对话流管理，包括消息发送、AI 回复渲染、历史会话管理等核心功能，并支持与真实 AI API 的集成。

项目基于详细的任务书开发，已完成 95% 的核心功能要求。
## 🌟 核心功能

### ✅ 已完成功能

- **💬 完整的对话界面**
  - 支持用户与 AI 的对话气泡渲染
  - 智能滚动和新消息自动定位
  - 消息状态管理（发送中、已发送、失败）

- **📝 富文本渲染**
  - 完整的 Markdown 语法支持（标题、列表、链接、表格等）
  - 代码块语法高亮（40+ 语言支持）
  - 一键复制代码块功能

- **⚡ 流式响应**
  - 真实的打字机效果
  - 支持 OpenAI 兼容 API 流式调用
  - 可中断的流式生成

- **📚 历史会话管理**
  - 新建、切换、删除对话
  - 对话标题自动生成
  - 本地数据持久化

- **📎 多模态支持**
  - 文件上传功能
  - 附件预览和展示
  - 支持图片等多媒体内容

- **🚀 性能优化**
  - 虚拟滚动技术，支持大量消息的流畅交互
  - 智能的滚动行为和内存管理

- **🔧 高级特性**
  - Mock/Real API 模式切换
  - 完整的错误处理和重试机制
  - 响应式设计，适配不同屏幕尺寸
### 🎯 待完善的功能
- **虚拟滚动优化**
- **上下文可选择夹带其他聊天**
- **聊天标题手动/自动修改**
- **上下文真实夹带附件**
## 🛠️ 技术栈

### 核心框架
- **前端框架**: React 19 + TypeScript
- **构建工具**: Vite (rolldown)
- **样式框架**: TailwindCSS 4
- **状态管理**: Zustand 5
- **包管理器**: pnpm

### 主要依赖
- **UI 组件**: React DOM
- **Markdown 渲染**: react-markdown + remark-gfm + rehype-raw
- **代码高亮**: rehype-prism-plus (基于 Prism.js)
- **虚拟滚动**: @tanstack/react-virtual
- **流式处理**: Web Streams API + eventsource-parser
- **图标库**: Heroicons (SVG React 组件)

### 开发工具
- **代码检查**: TypeScript ESLint
- **类型检查**: TypeScript 5.9
- **开发服务器**: Vite Dev Server
- **SVG 处理**: vite-plugin-svgr

## 🚀 快速开始

### 环境要求

- Node.js 18+
- pnpm 8+

### 安装依赖

```bash
pnpm install
```

### 启动开发服务器

```bash
pnpm run dev
```

项目将在 `http://localhost:5173` 启动。



## 📁 项目结构

```
src/
├── api/                 # API 接口层
│   ├── mock.ts         # Mock 数据实现
│   ├── real.ts         # 真实 API 实现
│   └── types.ts        # API 类型定义
├── components/          # React 组件
│   ├── Asider/         # 侧边栏组件
│   ├── ChatShell.tsx   # 主聊天界面
│   ├── MarkdownRenderer/ # Markdown 渲染器
│   └── Sender/         # 消息发送组件
├── store/              # Zustand 状态管理
│   ├── chatStore.ts    # 聊天状态
│   ├── configStore.ts  # 配置状态
│   └── userStore.ts    # 用户状态
├── types/              # TypeScript 类型定义
├── utils/              # 工具函数
│   ├── llm.ts         # AI API 工具
│   └── streamUtils.ts # 流式响应处理
└── assets/            # 静态资源
```

## 🔧 配置说明

### API 模式切换

项目支持两种运行模式：

1. **Mock 模式**（默认）：使用本地模拟数据，无需 API Key
2. **Real 模式**：连接真实 OpenAI API，需要配置 API Key

在侧边栏设置中可以切换模式并配置 OpenAI API 参数。

### OpenAI API 配置

在 Real 模式下，需要配置：
- API Key
- Base URL
- Model 名称（如 gpt-4, gpt-3.5-turbo）

## 💾 数据持久化

项目采用分层数据持久化策略，根据不同的运行模式提供相应的数据存储方案：

### Mock 模式

- **初始数据来源**：从 `mock/` 目录下的 JSON 文件获取预设的对话数据
- **新增对话存储**：所有新增的对话和消息仅存储在内存中
- **数据持久性**：页面刷新后，所有新增对话数据将消失，仅保留初始的 Mock 数据


### Real 模式

- **API 配置存储**：OpenAI API 的 Key、Base URL、Model 等配置信息存储在浏览器 localStorage 中
- **历史对话存储**：所有对话记录、消息内容、附件信息等完整数据持久化到 localStorage
- **数据同步**：支持跨会话的数据恢复，关闭浏览器后重新打开仍可恢复之前的对话状态
- **第三方兼容**：支持所有 OpenAI 兼容的 LLM 服务（如 Azure OpenAI、第三方代理等）
- **隐私说明**：所有数据仅存储在用户本地浏览器，不会上传到任何服务器

### 模式切换说明

- 从 Mock 模式切换到 Real 模式：需要配置 API 参数，新建对话将使用 Real 模式存储
- 从 Real 模式切换到 Mock 模式：保留 Mock 模式的初始数据，Real 模式的历史数据仍保存在 localStorage 中
- 数据隔离：两种模式的对话数据相互独立，不会相互影响

## 📚 开发说明

### 代码规范

- 使用 TypeScript 进行类型检查
- 遵循 ESLint 配置的代码规范
- 使用 TailwindCSS 的原子化 CSS 类名
- 组件使用函数式组件和 Hooks

### 状态管理架构

项目采用分层状态管理架构：
- **UI 层**: React 组件
- **状态层**: Zustand Store
- **数据层**: localStorage 持久化
- **API 层**: Mock/Real API 抽象

### 流式响应实现

项目实现了完整的流式响应链路：
1. 前端发起请求
2. 接收 SSE 流式数据
3. 实时更新消息内容（打字机效果）
4. 支持中断和错误处理

## 📄 许可证

MIT License

## 👨‍💻 作者

**Azuxa616**

---

