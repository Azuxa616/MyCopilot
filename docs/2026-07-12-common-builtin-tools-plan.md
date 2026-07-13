# 常用内置 Tools 实施计划

> **状态**：已完成
> **创建**：2026-07-12
> **关联**：Tool 安全级别系统、代码注册型 built-in tools

## 1. 目标

首批增加 7 个纯本地、无外部副作用的 `safe` 工具：

| Tool | 作用 | 输入摘要 |
|------|------|----------|
| `current_datetime` | 获取当前时间 | 可选 `timeZone`、`locale` |
| `calculator` | 计算基础算术表达式 | `expression` |
| `generate_uuid` | 生成 UUID v4 | 无 |
| `hash_text` | 生成 SHA-256 摘要 | `text` |
| `base64_encode` | UTF-8 文本编码为 Base64 | `text` |
| `base64_decode` | Base64 解码为 UTF-8 文本 | `data` |
| `json_format` | 校验并格式化 JSON | `json`、可选 `indent`、`sortKeys` |

本阶段不包含网络类 `url_metadata`，也不包含持久化 timer、提醒或 cron 调度。

## 2. 行为约束

- 所有工具通过 `ToolExecutor` 在代码中实现和注册，不写入 `tools` 表。
- 所有工具为 `safe`，使用稳定 ID、`sourceMcpId: null` 和版本化 `policyVersion`。
- 字符串处理工具输入上限为 1 MiB；超限、参数错误或取消统一返回 `isError: true`。
- `calculator` 不使用 `eval` 或动态代码执行，仅支持括号、加减乘除、取模、幂和一元正负号；表达式最长 512 字符。
- `hash_text` 固定使用 SHA-256；Base64 使用 UTF-8；`json_format.indent` 默认 2，范围 0–8。
- executor 返回单个 text content；结构化结果序列化为 JSON 字符串。

## 3. 实现步骤

1. 增加纯工具共享校验 helper，统一字符串取值、大小限制、取消检查和错误返回。
2. 实现安全 tokenizer、优先级解析器和有限数值校验，再接入 `calculator` executor。
3. 分别实现其余 6 个 executor，每个文件只负责一个工具。
4. 在 built-ins barrel 中导出统一 `builtinExecutors` 清单，服务启动时遍历注册。
5. 保留 `web_search` 和 `http_fetch`，统一进入同一个注册清单。

## 4. 测试与验收

- 每个工具覆盖 descriptor、正常输入、参数错误、输入上限和已取消 signal。
- 计算器覆盖优先级、括号、一元运算、幂、取模、除零、非法 token 和非有限结果。
- Base64 覆盖 Unicode 往返、空字符串、非法格式；JSON 覆盖格式化、压缩、递归排序和无效 JSON。
- 注册测试确认 9 个 built-in 名称与 ID 唯一，重复注册继续报错。
- 定向 Vitest、server TypeScript 检查和 `git diff --check` 作为完成门槛；仓库已有无关失败单独记录。
