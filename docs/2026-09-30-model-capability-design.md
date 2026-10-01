# 模型能力探测（三态 + 学习闭环）设计

**日期：** 2026-09-30
**状态：** 已实施（实施计划 `docs/2026-09-30-model-capability-plan.md`；学习闭环接线以附件资产层计划执行为前置）
**分支：** main
**来源：** 2026-09-30 产品形态讨论；DeepSeek vision 文档实证调研
**关联文档：** `2026-09-30-attachment-assets-multimodal-design.md`（门控消费方）

## 背景与动机

图片上传（多模态设计）需要知道当前模型是否支持 vision。现状 `Model` 类型（`packages/shared/src/provider.ts`）只有 `name/displayName/enabled` 等字段，无任何能力信息。

### 协议层事实（决定探测天花板）

| API | 能力信息 | 证据强度 |
|-----|---------|---------|
| OpenAI `/v1/models` | 无（仅 id/object/owned_by）——OpenAI 兼容生态标准接口普遍不携带能力 | 高 |
| Ollama `POST /api/show` | `capabilities: ["completion", "vision"]` | 高（官方 `docs/api.md` 原文验证） |
| Ollama `GET /api/tags` | 弱信号：`details.families` 含 `clip`/`mllama` 即 vision | 高（官方文档示例） |
| OpenRouter `/api/v1/models` | `architecture.input_modalities` + `modality` | 高（官方 API reference） |
| LM Studio `/api/v0/models` | `supported_parameters` 含 `vision` | 中（文档站抓取失败，未复核原文） |

### 同类产品机制（市场共识）

| 产品 | 机制 | 证据强度 |
|------|------|---------|
| LibreChat | yaml 手动声明模型列表（`models.vision`）+ modelSpecs 能力预设；`/api/models` 聚合下发 | 中高 |
| Open WebUI | 模型编辑器能力开关（Vision 等手动 toggle）+ Ollama families 启发式 | 中 |
| LobeChat | 精选模型目录（model bank），按模型 id 匹配能力元数据 | 中 |
| **共识** | **无一家做"自动发请求试错"探测**；均为 provider 原生信息 > 启发式 > 手动覆盖的分层 | — |

### DeepSeek 案例：启发式天花板的实证

- `deepseek-flash`：**支持** vision（OpenAI 兼容 `image_url` block，base64/URL/Files API 三通道，`detail: low|high|original|auto`，单图 token 封顶 1024，图片仅 user 消息否则 400）
- `deepseek-v4-pro`：**不支持**
- 两者命名同族，**名字无任何 vision 线索**；能力不在 `/models` 端点；厂商随时可为旧名开通新能力（旧名 `deepseek-v4-flash-vision-exp` 已退役仍被承接）

结论：**目录/正则永远滞后于厂商，体系必须以"三态 + 学习闭环"为核心，目录只是加速器。**

## 目标

1. `Model` 增加三态能力标记（yes / no / unknown）与来源标注（manual / catalog / provider / probe）
2. 四层解析算法（手动 > provider 原生 > 启发式目录 > 默认 unknown）
3. 学习闭环：真实请求成败自动反写能力记录
4. 探测按钮：设置页模型行"测试图片输入"
5. UX 三段式防御规范（事前 / 事中 / 事后）

## 非目标

- 不探测 tool_use / audio 等其他能力（`capabilities` 结构预留扩展位）
- 不做后台自动全模型扫描（只做用户触发 + 请求驱动的隐式学习）
- 不按 baseUrl 特判 OpenRouter / LM Studio（它们走 openai 类型 provider 时与标准端点无异；未来可作为 provider 类型扩展）
- 不维护远端能力目录服务（catalog 随宿主版本发布）

## 决策记录（用户已确认 + 建议）

| 决策点 | 结论 | 备选与理由 |
|--------|------|-----------|
| 能力取值 | **三态** `yes \| no \| unknown` | 二态无法表达"不知道"——deepseek 案例证明未知是新模型常态；unknown 态 UX 是本设计核心 |
| 解析优先级 | manual > provider > catalog > 默认 unknown | 手动是最终仲裁，永不被自动反写覆盖（对齐 LibreChat/Open WebUI 共识） |
| unknown 的 UX | **允许发送**（隐式探测）：成功升 yes、400 能力性错误降 no | 禁用会阻断新模型能力发现；用一次真实请求换取确定性 |
| 反写错误判定 | 仅 HTTP 400 + 能力性错误结构反写 no；网络/鉴权/限流错误不反写 | 防止把断网误记成"不支持" |
| 探测按钮（L4） | **纳入 v1**（用户已确认）：设置页模型行"测试图片输入"，发一张小图几秒出结果，写 source = `probe` | deepseek 案例证明目录追不上厂商；成本极低，是唯一的前置确定手段 |

## 数据模型

### `models` 表加列

```sql
ALTER TABLE models ADD COLUMN capabilities TEXT NOT NULL DEFAULT '{}';
```

### Shared 类型

```ts
/** 单项能力的取值。 */
export type CapabilityState = 'yes' | 'no' | 'unknown';

/** 能力值的来源。 */
export type CapabilitySource = 'manual' | 'catalog' | 'provider' | 'probe';

export interface ModelCapabilities {
  /** 图片输入能力。缺省视为 unknown。 */
  vision?: CapabilityState;
  /** 各能力的来源标注（键同名）。 */
  sources?: Partial<Record<'vision', CapabilitySource>>;
  /** 探测时间戳（source = probe 时有意义）。 */
  probedAt?: number;
}
```

存量为空对象 = 全 unknown，零迁移。

## 解析算法

```text
resolveCapability(model, provider):
  1. manual   : capabilities.vision 手工设置（source=manual）→ 直接返回
  2. provider : provider.type = 'ollama'
                  → POST {baseUrl}/api/show {model} 读 capabilities 数组
                    含 'vision' → yes；明确不含 → 保持 catalog 判定（show 可能滞后于模型替换）
                  （可选弱信号：/api/tags details.families 含 clip/mllama → yes）
                provider.type = 'openai' → 无信息，跳过
  3. catalog  : 内置"已知模型名 → 能力"规则表（packages/shared，随版本更新）
                命中 → 写入 source=catalog 的缓存值
  4. 默认     : unknown
```

catalog 规则表形如 `[/^gpt-4o/, 'yes']`、`[/^deepseek-flash/, 'yes']`、`[/^deepseek-v4-pro/, 'no']`、`[/^llava|qwen.*-vl|glm-4v/, 'yes']`——**只收录确认过的条目**，宁缺毋滥（错判 no 比漏判 yes 更伤：直接禁用了入口）。

## 学习闭环

| 触发 | 条件 | 动作 |
|------|------|------|
| 请求成功 | 出站含 image part 且 vision = unknown | 升 `yes`，source = `probe` |
| 请求失败 | HTTP 400 且错误分类器判定为能力性（unsupported modality / invalid content type 类关键词或结构） | 降 `no`，source = `probe` |
| 用户编辑 | 设置页模型能力开关 | 写 source = `manual`，此后**永不被自动反写覆盖** |

错误分类器落在 adapter 层（provider 错误结构各异），输出稳定错误码供复用（对齐 `PluginLifecycleError` 的 errorCode 先例）。

## UX 规范（三段式防御）

| 层 | 时机 | 行为 |
|----|------|------|
| **事前** | `vision = no` | 图片上传入口置灰 + tooltip「{model} 不支持图片输入」；拖拽/粘贴被拦截并 toast 同因；模型选择器显示 vision 徽标 |
| **事中** | 已附图后切换到 no 模型（竞态） | Sender 警告条三选：**切换模型 / 移除图片 / 仍发送**（仍发送 = image part 降级为占位文本，格式 `[图片: name]` 与多模态设计的纯文本投影一致） |
| **事后** | 能力记录错误（unknown 直发失败） | 服务端错误转译人话（「该模型不支持图片输入，已记录。可切换至 {建议模型}」）+ 反写 no → 下次事前层生效 |
| unknown 弱提示 | `vision = unknown` | 图片入口可用，Sender 显示一次性弱提示「未确认该模型支持图片，首次发送将自动验证」 |

能力值在设置页可查看来源徽标（`手动 / 探测 / 目录 / 未知`），用户可将猜测升格为 manual。

## 与现有系统的咬合

- **多模态消息设计**：出口组装的门控与"仍发送"降级的唯一消费方；发送成败信号回灌本设计的学习闭环
- **adapter 层**：错误分类器依附于现有 provider adapter 结构
- **DIY agent 设计**：`agent.modelId > session.modelId` 的模型解析链路上，能力取自最终生效模型

## 开放问题

1. **L4 探测按钮进 v1 终确认**（建议：进。设置页模型行一个"测试图片输入"，发一张小图几秒出结果，写 source = `probe`）
2. catalog 的维护节奏：随宿主版本发布 vs 独立 JSON 可热更新——建议随版本（YAGNI）
3. Ollama `/api/show` 探测的时机：模型列表刷新时批量（N 次请求）vs 首次使用时惰性——建议惰性

## 参考文献

- DeepSeek 图像理解（含 deepseek-flash 与 deepseek-v4-pro 的能力差异、detail 分级、图片仅 user 消息约束）：<https://api-docs.deepseek.com/zh-cn/guides/vision>
- Ollama API（capabilities 字段）：<https://github.com/ollama/ollama/blob/main/docs/api.md>
- OpenRouter Models API（input_modalities）：<https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties>
- LibreChat / Open WebUI / LobeChat 机制为中置信调研结论（标注于背景章节），实施时不依赖
