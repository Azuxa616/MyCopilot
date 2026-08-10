/**
 * 插件安全与威胁模型——TypeScript 类型定义。
 *
 * 自包含模块：不导入 @my-copilot/shared 或任何其它包。每个类型都内联声明，
 * 因此本文件可独立通过 `tsc --noEmit docs/rfc/types/plugin-security.d.ts` 类型检查。
 *
 * 这些类型是 docs/rfc/plugin-security-threat-model.md 以及两份 schema
 * （docs/rfc/schemas/plugin.permissions.schema.json 与
 * docs/rfc/schemas/plugin.audit-log.schema.json）所引用的规范契约。
 *
 * 本 RFC 复用（绝不重新发明）docs/2026-07-11-tool-safety-system-design.md
 * 中定义的 3 级 SafetyLevel。SafetyLevel 仅在此重新声明以保持文件自包含；
 * 权威定义位于 packages/shared/src/tool.ts。
 */

// ---------------------------------------------------------------------------
// 复用的 3 级安全模型（权威副本位于 packages/shared）
// ---------------------------------------------------------------------------

/**
 * 本 RFC 复用的三个安全级别。严格度顺序为 safe < restricted < danger，
 * 由 apps/server/src/tools/executor.ts:25-29 的 STRICTNESS 编码。
 * `stricterLevel` 辅助函数（executor.ts:232-234）取两个级别的最大值；
 * 插件工具被钳制为至少 `restricted`（executor.ts:224-226）。
 */
export type SafetyLevel = 'safe' | 'restricted' | 'danger';

// ---------------------------------------------------------------------------
// 信任层级（决策 A4）
// ---------------------------------------------------------------------------

/**
 * 三层信任梯度。清单上的 `source` 字段（T4）是唯一的信任判别器；
 * Tier 1 不是清单 `source` 取值，因为内建代码从不过插件协议。
 *
 *   Tier 1 内建（Built-in）  -> 进程内，完全信任，从不作为插件被审计。
 *   Tier 2 官方（Official）  -> 进程内（或 Artifact Renderers 的沙箱化），
 *                              由可验证签名门禁。
 *   Tier 3 社区（Community） -> 子进程沙箱，每项能力需用户显式同意，
 *                              每个权限受控动作都被审计。
 */
export type TrustTier = 1 | 2 | 3;

/**
 * 宿主验证后的清单 `source` 取值。作者可声明 `"official"`，但若签名检查失败，
 * 宿主就把内存中的取值改写为 `"community"`，并记录一次 Spoofing（欺骗）
 * 审计事件（合规 C1）。`built-in` 从不是清单 source。
 */
export type VerifiedPluginSource = 'official' | 'community';

// ---------------------------------------------------------------------------
// 权限声明（镜像 plugin.permissions.schema.json）
// ---------------------------------------------------------------------------

/**
 * 相对于插件沙箱（$PLUGINS_DIR/<plugin_id>/）解释的 glob 模式。
 * 在符号链接解析之后解析到沙箱之外的模式被视为穿越尝试而被拒绝。
 */
export type GlobPattern = string;

/**
 * 限定在插件沙箱内的文件系统访问。空数组（或缺省 key）表示无访问。
 */
export interface FilesystemPermissions {
  /** 插件可读取的 glob 模式，相对于其沙箱。 */
  read: GlobPattern[];
  /** 插件可写入的 glob 模式，相对于其沙箱。 */
  write: GlobPattern[];
}

/**
 * 插件可做什么的上限。在清单 `permissions` 块中声明；由宿主在调用前强制。
 * 试图使用未声明的能力即一次权限提升尝试（合规 C4）。
 */
export interface PluginPermissions {
  /** 插件可注册工具执行器（默认最低 SafetyLevel 'restricted'）。 */
  tools: boolean;
  /** 插件可打开出站 socket，仅限 networkAllowlist 中的主机。 */
  network: boolean;
  /** network 为 true 时插件可联系的主机。此时必须非空。 */
  networkAllowlist: string[];
  /** 限定在插件沙箱内的文件系统读/写 glob。 */
  filesystem: FilesystemPermissions;
  /** 插件可在其沙箱内派生子进程。 */
  childProcess: boolean;
  /** 插件可读取的环境变量名。不得包含 AUTH_TOKEN。 */
  envVars: string[];
}

// ---------------------------------------------------------------------------
// 审计日志（镜像 plugin.audit-log.schema.json）
// ---------------------------------------------------------------------------

/**
 * 宿主审计的权限受控动作集合。每个动作发出一条记录。这是反抵赖原语
 * （T6 规范 7）。
 */
export type AuditEventType =
  | 'tool_call' /** 一次需要确认的工具调用。 */
  | 'network_egress' /** 一次出站连接尝试。 */
  | 'filesystem_write' /** 一次在插件沙箱内的写入。 */
  | 'child_process_spawn' /** 一次在沙箱内的子进程派生。 */
  | 'permission_denied' /** 一次已声明能力调用被拒绝。 */
  | 'privilege_escalation' /** 一次未声明能力使用尝试。 */
  | 'signature_check' /** 一次安装时签名验证结果。 */
  | 'package_digest_check'; /** 一次安装/加载摘要检查结果。 */

/** 被审计动作的结局。 */
export type AuditOutcome = 'success' | 'denied' | 'error' | 'privilege_escalation';

/**
 * 单条审计日志记录。存储是 T6 的非目标；这是任何未来存储后端**必须**接受
 * 的记录形状。
 */
export interface PluginAuditRecord {
  eventId: string;
  pluginId: string;
  eventType: AuditEventType;
  timestamp: number;
  /** 稳定序列化动作参数的 SHA-256 十六进制摘要。 */
  argsDigest: string;
  /** 规范化作用域：'path:' + 前缀，'origin:' + 规范化来源，或带命名空间的工具引用。 */
  resourceScope: string;
  outcome: AuditOutcome;
  /** 动作发生在某次 run 内时存在。 */
  runId?: string;
  /** 动作发生在某个 session 内时存在。 */
  sessionId?: string;
  /** 非成功结局时的稳定错误码。 */
  errorCode?: string;
  /** 简短的人类细节；不得包含机密或完整参数正文。 */
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// 故障传播（T6 规范 6）
// ---------------------------------------------------------------------------

/**
 * 插件故障模式到宿主响应的映射。宿主**必须**遵守该矩阵；临时性恢复
 * 是不合规的。
 */
export type PluginFailureMode =
  | 'crash' /** 子进程崩溃 / 非零退出。 */
  | 'tool_timeout' /** 工具调用超出其预算。 */
  | 'hook_timeout' /** 生命周期 hook 超出其预算。 */
  | 'oom' /** 内存上限超出。 */
  | 'permission_denied' /** 已声明能力调用被拒绝。 */
  | 'privilege_escalation' /** 未声明能力使用尝试。 */
  | 'ipc_flood'; /** 无界输出超出字节预算。 */

/**
 * agent 循环对插件故障的响应。
 */
export type AgentLoopResponse =
  | 'continue_with_error' /** 工具结果标记为 isError；运行继续。 */
  | 'abort_run' /** Run 转入 status 'aborted'。 */
  | 'disable_plugin_session' /** 插件在会话剩余时间内被禁用。 */
  | 'warn_and_continue'; /** 响应被截断；运行继续，插件被警告。 */

/**
 * 故障传播矩阵的一行。
 */
export interface FailurePropagationRow {
  failureMode: PluginFailureMode;
  loopResponse: AgentLoopResponse;
  /** 此次故障后插件在该会话内是否仍保持启用。 */
  pluginRemainsEnabled: boolean;
}

/**
 * 完整的故障传播矩阵。合规宿主通过本表解析每个插件故障。
 */
export declare const FAILURE_PROPAGATION_MATRIX: FailurePropagationRow[];

// ---------------------------------------------------------------------------
// 沙箱资源上限（T6 规范 4）
// ---------------------------------------------------------------------------

/**
 * 应用于每个 Tier 3 子进程沙箱的资源上限。默认值在此编码；合规宿主强制
 * 每个上限，并把违规通过故障传播矩阵处理。
 */
export interface SandboxResourceCaps {
  /** 最大驻留内存字节数。默认 256 MiB。 */
  maxMemoryBytes: number;
  /** 每次工具调用的最大 CPU 时间预算（毫秒）。 */
  maxCpuTimeMs: number;
  /** 最大打开文件描述符数。 */
  maxOpenFiles: number;
  /** 单次 IPC 响应在截断前（ipc_flood）的最大字节数。 */
  maxIpcResponseBytes: number;
}

/**
 * SandboxResourceCaps 的解析默认值：maxMemoryBytes = 268435456
 * （256 MiB），maxCpuTimeMs = 30000，maxOpenFiles = 64，
 * maxIpcResponseBytes = 1048576（1 MiB）。
 */
export declare const DEFAULT_SANDBOX_CAPS: SandboxResourceCaps;
