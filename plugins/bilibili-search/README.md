# bilibili-search 插件

让 MyCopilot 的 agent 可以搜索 B 站视频，并在对话中返回视频卡片（封面 + 标题链接 + 播放数据）。

## 组成

```
bilibili-search/
├── plugin.json              # 插件清单（声明 MCP 服务 + skill）
├── server/index.ts          # 零依赖 MCP stdio 服务（Node 24+ 直接运行 TS，无需安装依赖）
├── skills/bilibili-search.md # agent 使用指引（安装后自动注册为 bilibili-search:bilibili-search skill）
└── README.md
```

- **能力来源**：`provides.mcpServers` 声明一个 stdio MCP 服务，安装启用后向 agent 暴露 `bilibili_search_videos` 工具（工具名为全限定原名，无额外前缀，故自带 `bilibili_` 前缀防冲突）。
- **B 站访问**：搜索接口需要 wbi 签名与 buvid cookie，均由服务在运行时自动匿名获取并缓存（wbi 密钥 12h、buvid 30 天），**无需任何配置或登录**。
- **输出**：markdown 卡片（立即可用）+ JSON 卡片数据（`type=bilibili-video`，为未来的前端卡片渲染器预留）。

## 安装

前提：宿主 server 使用 Node 24+（直接运行 TS）。

1. **根目录 `.env`**（没有就从 `.env.example` 复制）加一行——相对路径相对仓库根，`pnpm dev` 启动器会自动解析为绝对路径：

   ```
   PLUGINS_DIR=plugins
   ```

2. **安装并启用**（重启 dev 后）：

   ```bash
   # AUTH_TOKEN 替换为你的 token
   curl -X POST http://localhost:3000/api/plugins/install \
     -H "Authorization: Bearer $AUTH_TOKEN" -H "Content-Type: application/json" \
     -d '{"directory": "bilibili-search"}'

   curl -X PATCH http://localhost:3000/api/plugins/bilibili-search/enable \
     -H "Authorization: Bearer $AUTH_TOKEN"
   ```

3. **验证**：对话中让 agent「搜一下 xxx 的 B 站视频」。工具首次调用需按受限工具惯例确认一次（restricted 级）。

## 注意事项

- **绝对路径**：宿主拉起 stdio MCP 子进程时不设 cwd（继承 server 进程目录），因此 `plugin.json` 中 `args` 使用了本机绝对路径。换机器/换目录部署时需同步修改。
- **source=official**：本插件声明为官方插件（community 插件被宿主禁止直接 enable）。代价是**官方插件不允许卸载**——如需彻底移除，先 disable，再手动清理 SQLite `plugins` 表对应行。
- **子进程环境**：宿主以空环境变量拉起本服务，服务不依赖任何环境变量；但匿名搜索受 B 站风控影响，偶发 HTTP 412 属正常，稍后重试即可。
- **Docker**：容器内需将 `plugins/` 挂载进镜像并改写 `plugin.json` 中的绝对路径为容器内路径。
