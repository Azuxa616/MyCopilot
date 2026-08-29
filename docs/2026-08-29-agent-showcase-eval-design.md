# Agent 展示与评估体系（执行轨迹 + 自建 Eval + 演示页）设计

**日期：** 2026-08-29
**状态：** 已实施（分支 `dev`，迁移 0008/0009/0010 已应用；实施计划与逐 todo 验收记录见 `.omo/plans/agent-showcase-eval.md` 与 `.omo/evidence/`；评估快照 `apps/server/src/eval/snapshot.json` 随仓库分发）
**分支：** dev
**来源：** 演示站叙事需求（访客看不到 agent 能力）+ agent 迭代缺量化回归的工程痛点

## 背景与动机

agent 能力（工具调用、预算管理、审批流）长期只存在于服务端运行时里，两类人群都感知不到：

| # | 痛点 | 现状事实 |
|---|------|---------|
| 1 | **能力不可见** | 每次执行的完整轨迹是「算完就扔」的一次性流：SSE 事件驱动完 UI 后不留任何持久记录，访客与开发者都看不到 agent「怎么想的、用了哪些工具、每步花多久、上下文预算怎么分配」。前端历史渲染还丢弃信息：历史工具调用、tool_result 内容、中断时的 partialContent、错误码、多附件均不展示 |
| 2 | **迭代无评估** | agent loop（Run 状态机、LoopGuard、三级工具安全、预算降级链）的每次改动只靠手工冒烟，没有一条命令可跑的量化成绩单，回归靠人肉，改坏无人知 |

演示站进一步放大了这两个痛点：访客只有 30 秒耐心，没有可见的过程与可量化的成绩，能力等于不存在。

## 目标

1. **执行轨迹持久化**：每次 Run 的每一步（`llm_call` / `tool_exec`）与 Run 级汇总（状态、停止原因、迭代数、六桶预算快照、降级标记）落 SQLite，聊天内可回看，demo 站可查询。
2. **自建评估体系**：确定性场景（真 runtime + 假 LLM，零成本零波动）与 live 场景（真实模型，trials=3 的 pass^k 一致性统计）双层结构，`pnpm eval` 一条命令出成绩单，确定性失败即非零退出码作为迭代回归门禁。
3. **展示层**：聊天内轨迹时间线与六桶预算仪表；`/capabilities` 能力对比页与 `/evaluations` 评估仪表盘两个演示页；demo 角色只读白名单放行全部新查询端点。
4. **思考过程持久化**：reasoning 随 assistant 消息保存，刷新后仍在。

## 非目标

- 不做用户自定义 Agent（DIY agent 另行立项，见 `docs/2026-08-15-diy-agent-design.md`）。
- 不做多 agent 编排 / 外部 agent 引擎嵌入。
- 不引入任何外部 eval/trace 平台（promptfoo、Langfuse、OTel 等）或其 SDK；不引图表库（前端纯 CSS/SVG 自绘）；不新增前端运行时依赖。
- 不做 LLM-as-judge（v1 仅规则断言，judge 留作扩展点，见开放问题）。
- 不改 SSE 既有 12 种事件（`placeholder`/`delta`/`done`/`error`/`aborted`/`tool_call_start`/`tool_call_delta`/`tool_call_done`/`tool_result`/`confirmation_required`/`job_status`/`reasoning`）的语义；新增端点全部走 REST，且 demo 下仅 GET 只读。
- 不向 demo 工具白名单新增网络类工具（SSRF 面不变，`demo/tools.ts` 的 `DEMO_ALLOWED_TOOLS` 维持 7 个本地工具）。
- 不新增 CI/CD 流水线（项目无 CI；eval 以 `pnpm eval` 命令交付）。
- 不做真实 Run 的事件流级重放：`runs` 表存预览不存完整事件流，真实 Run 只有步骤时间线视图；「重放」一词仅用于 eval 场景的确定性回放。

## 三层架构

演示与评估共用同一个地基：先把过程数据持久化（第一层），评估在其上跑（第二层），展示层把两层的数据讲给访客听（第三层）。

### 第一层：Trace 持久化

- **共享类型**（`packages/shared/src/trace.ts`，零运行时）：`RunTraceRecord`、`RunStepRecord`、`TraceCollector` 接口（`onRunStart`/`onStep`/`onRunEnd`）。
- **采集方式**：`TraceCollector` 以参数注入 `agent-loop/runner.ts`，旁路观察者身份，不改状态机转移、不改 SSE 事件流；collector 内部异常一律吞掉并 `console.warn`，trace 失败绝不影响主流程。每步记录：`llm_call`（耗时 + 该轮 token 估算）、`tool_exec`（工具名、参数预览、结果预览、`isError`、耗时，预览截断至 500 字符）。
- **真实 userMessageId 语义**（评审修正 S1-2）：`RunAgentLoopParams.userMessageId` 的既有语义是 assistant 占位消息 id，不得直接落库。同步链路在 `streaming/lifecycle.ts` 创建用户消息时捕获真实 id；异步链路扩展 job payload 新增 `realUserMessageId` 字段（`jobs/worker.ts` 读取），字段缺失（旧存量 payload）时 warn 并跳过该 Run 的采集，`runs.user_message_id NOT NULL` 禁止回退写占位 id。
- **僵尸 Run 清理**：`repo/runTrace.ts` 的 `markStaleRunsOnBoot()` 在服务启动时把非终态 Run 批量置为 `failed`（error = 服务重启中断）。
- **只读查询 API**：`GET /api/sessions/:id/runs`（按开始时间倒序，含 steps 计数聚合）与 `GET /api/runs/:runId`（详情含全部步骤）。`run.id` 用 `randomUUID` 生成，不可枚举。

### 第二层：Eval 体系（完全自建，TS + SQLite）

- **FakeProviderAdapter**（`llm/testing/fake-adapter.ts`）：脚本化 `StreamEvent[][]` 回放，每轮弹出下一组事件，轮次耗尽抛错；同时服务单测与评估。
- **场景 DSL**（`packages/shared/src/eval.ts`）：`EvalScenario`（id、分类 `loop|context|safety|recovery|task`、mode、工具集、脚本、断言数组）+ `EvalAssertion` 判别联合（`status`/`tool_sequence`/`final_contains`/`degraded`/`summary_created`/`approval_flow`/`max_steps_hit`）+ 元数据 `behavior`（审批自动 approve/reject、第 N 个结果后 abort）、`requiredEnv`、`replayable`。
- **内置场景集**（`eval/scenarios/`，共 19 个）：确定性 9 个（`multi-step-tool-chain`、`repeat-call-guard`、`tool-error-recovery`、`context-degradation`、`summarization-trigger`、`approval-approve-flow`、`approval-reject-flow`、`max-steps-termination`、`user-abort-partial`）+ live 10 个（`live-*`，覆盖工具调用、格式校验、错误恢复等）。
- **双层 runner**（`eval/runner.ts`）：deterministic 在 eval 子进程内 `initDatabase(独立临时目录)` 后整链路真实执行（工具真实运行、审批自动注入、脚本化 LLM）；live 从库中取 enabled provider 走真实模型，trials 串行执行，超时兜底 60s（确定性）/ 300s（live）。
- **规则评分器 + 故障归因**（`eval/scorer.ts`）：逐断言求值产出 `assertionResults`，失败按证据归因五类：`timeout`（仅兜底路径）→ `other`（终态 failed）→ `repeat_blocked`（存在 skipped isError 步骤）→ `used_wrong_tool`（tool_sequence 断言失败）→ `goal_incomplete`（其余）。
- **结果落库**（`eval_runs` 表，迁移 0009）：不设 UNIQUE 约束，防重由 CLI「按 scenario 清旧插新」的替换语义保证；只经 `run_trace_id` 松耦合关联 `runs`，不外键到 sessions。
- **CLI**（`eval/cli.ts`，根 `package.json` 已代理 `pnpm eval`）：`--mode deterministic|live|all`（默认 deterministic）、`--scenario <id>`、`--report`（生成 `apps/server/src/eval/snapshot.json`）、`--keep-db`、`--replay-json <path>`（供回放端点）。确定性任一 fail 退出码非零；live 只记录不影响退出码。

### 第三层：展示层

- **聊天内**：修补历史渲染的 10 处信息丢弃（工具调用折叠卡、tool_result 内容、`aborted.partialContent`、`error.code`、多附件等）；新增 `RunTraceTimeline`（步骤时间线，渐进披露三层：收起条 → 展开摘要 → 原始 JSON `<pre>`）与 `ContextBudgetMeter`（六桶 `system/tools/history/toolOutputs/working/headroom` 堆叠条 + degraded 琥珀徽标）；经 `latestRunByUserMessage` 匹配后挂在触发本次执行的用户消息下方，默认收起。
- **reasoning 持久化**（迁移 0010）：runner 逐轮累积 reasoning 增量随 assistant 消息写库，历史渲染复用 `ReasoningBlock`；`assembleMessagesV2` 装配 LLM 输入时显式忽略该列，防历史思考吃掉六桶预算。
- **`/capabilities` 能力对比页**：纯静态零后端请求。「MyCopilot Runtime vs 普通 AI Chat」对比表（SSE 12 种事件 vs 单流 delta、六桶上下文预算 vs 无管理、三级工具安全 + 审批 vs 无工具、Run 8 状态机 vs 单轮请求、LoopGuard 防死循环、MCP/Skills/Plugin 扩展、后台任务、双 token 安全降权）+ Run 状态机纯 CSS 转移图 + 三级安全色卡。
- **`/evaluations` 评估仪表盘**：聚合指标卡（passRate、场景总数、平均步数、recoveryRate）、场景表格（含 `faultType` 徽标与断言明细展开）、确定性场景「现场回放」按钮（回放结果复用 `RunTraceTimeline` 渲染）、快照元信息脚注（generatedAt、gitCommit 短哈希）；快照为空时显示引导文案。live 场景不提供站内触发按钮。
- **导航**：`Asider` 的「能力」「评估」入口无条件渲染（demo 访客可见）；「设置」入口维持 demo 隐藏。

## 数据模型与迁移

| 迁移 | 内容 |
|---|---|
| `0008_run_traces.sql` | `runs` 表（id、session_id 外键级联删除、user_message_id NOT NULL、assistant_message_id、agent_id、job_id、status CHECK 8 态、stop_reason、iterations、budget_snapshot、degraded、total_tokens、起止时间、error）+ `run_steps` 表（run_id 外键级联、seq、type CHECK `llm_call|tool_exec`、tool_name、args_preview、result_preview、is_error、duration_ms、created_at，`UNIQUE(run_id, seq)`）+ session/run 维度索引 |
| `0009_eval_runs.sql` | `eval_runs` 表（scenario_id、mode、status、trial、metrics JSON、fault_type、run_trace_id 外键 `ON DELETE SET NULL`、assertion_results JSON、起止时间）+ `(scenario_id, mode)` 普通索引；有意不设 UNIQUE 约束 |
| `0010_message_reasoning.sql` | `ALTER TABLE messages ADD COLUMN reasoning TEXT`（SQLite ADD COLUMN 无默认，旧数据 NULL；纯文本直存，仅供前端渲染） |

## 评估方法论

- **确定性回放原理 = 真 runtime + 假 LLM**：除 LLM 边界被脚本替换外，Run 状态机、LoopGuard、三级工具安全与审批流、预算降级链（L1 压缩 / L2 摘要 / L3 截断）、消息持久化全部真实执行，工具真实运行。token 计数走 `estimateMessagesTokens` 的 chars/4 近似，不依赖 LLM usage 上报，因此 FakeAdapter 无需 usage 注入能力，确定性完全成立。
- **env 注入时序**：`eval-env.ts` 必须是 `cli.ts` 首个 import（ESM 按声明序求值），因为 `MYCOPILOT_E2E_TOOLS` 在 `tools/builtins/index.ts` 模块求值期读取；env 采用静态常量表并无条件覆盖，保证不受宿主 shell 环境影响（双跑一致的前提）。
- **τ-bench 式终态对比**：断言盯终态与副作用（终态 status、工具执行序列、最终文本、`degraded`、summary 副作用、审批表终态），不逐字比对中间轨迹，给实现留自由度。失败时按证据归因五类（见第二层）。
- **pass^k 借鉴**：live 场景 trials=3 串行执行，全部 trial 一致通过才计 pass（`pass_k` 指标）；live 成功率是度量对象而不是门禁，不影响退出码。
- **快照冻结 vs 现场回放双轨语义**：快照 = 生成时点的冻结成绩单（版本化、随 git 分发、demo 站直接读文件）；回放 = 以当前代码现场确定性重放（子进程、独立临时库）。二者数值存在差异是预期特性而非不一致：快照回答「那个版本考了多少分」，回放回答「现在的代码这一题怎么解」。
- **元校验**：确定性场景强制 `replayable: true`；场景 id 唯一；确定性场景文件禁止引用 `http_fetch`/`web_search`。
- **回归门禁**：确定性场景任一 fail → `pnpm eval` 退出码非零，可直接用作改动 agent 后的自查命令。

## demo 集成

- **DEMO_TOKEN 只读白名单**：`middleware/tokenAuth.ts` 的 `DEMO_ROUTE_RULES`（`{ method, pattern }` 精确正则数组，默认拒绝）追加 5 条 GET 规则：`/api/sessions/:id/runs`、`/api/runs/:runId`、`/api/eval/snapshot`、`/api/eval/scenarios`、`/api/eval/scenarios/:id/replay`。白名单外一律 403（`/api/providers` 依旧拒绝）。
- **子进程回放零成本**（评审修正 S1-1）：回放端点以 `spawn('npx', ['tsx', 'src/eval/cli.ts', '--scenario', id, '--replay-json', <tmpfile>])` 执行（cwd 为 `apps/server`，与 demo 容器运行服务同款方式）；独立临时数据库与 requiredEnv 注入全部发生在子进程内，server 主进程绝不调 `initDatabase` 切库。确定性场景不产生任何真实模型费用。防滥用护栏：并发最多 2 个子进程（超出 429）、60s 超时 kill、临时目录 finally 清理；live 或 `replayable: false` 场景返回 400。
- **快照分发**：`snapshot.json` 位于 `apps/server/src/eval/` 内，Docker 构建 `COPY apps/server` 整目录带入镜像；服务端按请求读取（`readFileSync(__dirname)` 资产模式），文件缺失时兜底空结构而不 500，重新生成快照无需重启服务。快照端点不暴露场景脚本全文（评估提示词资产不外泄）。
- **每日重置兼容**：`docker/reset-demo.sh` 清空演示数据卷，`runs` 轨迹数据随之清零，访客轨迹最多存活 24 小时，与既有访客数据存活期一致，属预期取舍（也因此 demo 实例无孤儿 Run 累积问题）；快照与现场回放不受重置影响（前者是随镜像分发的文件，后者跑在子进程临时库）。非 demo 实例的重启中断场景由 `markStaleRunsOnBoot()` 兜底。
- **隐私与安全边界**：`run.id` 为 `randomUUID` 不可枚举；预览截断 500 字符；demo 下轨迹预览的跨访客可见性与 demo 部署 spec「访客间会话可见」既有取舍一致，不额外隔离。

## 决策记录

| 决策点 | 结论 | 备选与理由 |
|---|---|---|
| eval 自建 vs 外部平台 | 完全自建（TS + SQLite），不引 promptfoo/Langfuse/OTel | 调研结论：外部平台面向 API 级 LLM 调用评测，接不进进程内 runtime 行为（状态机、预算降级、审批副作用都测不到）；自建零新增运行时依赖、数据留在本地 SQLite、DSL 可直接表达 agent 终态断言，且「快照文件 + 子进程回放」的 demo 集成形态外部平台无法提供 |
| 回放执行位置 | 子进程（S1-1） | 备选「server 进程内 `initDatabase` 切临时库」被否：主进程 DB 单例绝不允许切换，会污染用户库；子进程方案天然隔离，代价仅是一次 tsx 启动 |
| userMessageId 语义 | 落库必须用真实用户消息 id（S1-2） | 旧参数语义是 assistant 占位 id，直接落库会让轨迹关联错位；同步链路捕获、异步链路扩展 payload，缺失时宁可跳过采集也不写错值（NOT NULL 禁止回退） |
| L2 摘要轮预留 | `context-degradation` 脚本必须三轮（评审修正） | 降级链 L1 之后仍超预算且 adapter 存在时，L2 无旁路必调 `summarizeHistory` 并消耗一轮脚本；L3 截断纯本地不耗轮。脚本少一轮会因轮次耗尽而 error |
| trace 失败策略 | 采集异常吞掉 + warn，绝不影响主流程 | 对齐 runner 内 onEvent 解耦先例；可观测性旁路不得成为新的故障面 |
| 快照不写库 | 文件即真相，随 git 分发 | 备选落 `eval_runs` 表被否：demo 站读文件零 DB 依赖、代码评审可见成绩变化、避免快照与库数据双真相 |

## 开放问题

1. **LLM-as-judge**：规则断言覆盖「过程正确性」，覆盖不了「回答质量」类目标。judge 作为后续扩展点，需先解决 judge 模型自身的稳定性与成本问题。
2. **live 场景扩充**：现有 10 个 live 场景集中在工具调用与格式类，多轮任务型场景（如多步信息聚合）待补。
3. **多模型对比**：快照当前聚合单 provider 结果，按模型分维度出对比成绩单（同一场景集在不同模型上的 pass 率）待做。

## 参考文献

- `.omo/plans/agent-showcase-eval.md`（实施计划与逐 todo 规格）
- `docs/superpowers/specs/2026-08-22-demo-deployment-design.md`（demo 白名单默认拒绝原则与验收基线）
- `docs/deploy-demo.md`（演示版部署与评估快照更新流程）
