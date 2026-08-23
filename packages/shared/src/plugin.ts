/**
 * 插件清单与生命周期 —— 运行时共享类型。
 *
 * 自 docs/rfc/types/plugin-manifest.d.ts 移植（逐一对应，不改名不删减），
 * 规范来源：docs/rfc/plugin-manifest-lifecycle.md 与 docs/rfc/schemas/plugin.manifest.schema.json、
 * plugin.lifecycle-event.schema.json。除 DEFAULT_PLUGIN_BUDGET 外均为纯类型。
 */

// ---------------------------------------------------------------------------
// 标识符和版本原语
// ---------------------------------------------------------------------------

/** 插件标识符。小写 kebab-case，跨版本稳定，用作 `pluginId:resourceName` 引用的命名空间前缀。 */
export type PluginId = string;

/**
 * 插件的来源层级（决策 A4）。
 * 'built-in' 被有意省略 —— 内置项编译进宿主二进制，不走插件协议；
 * 仅官方（'official'）与用户安装（'community'）插件可通过清单寻址。
 */
export type PluginSource = 'official' | 'community';

/** 语义化版本 2.0.0 字符串。 */
export type SemVer = string;

/** npm 风格的 semver 范围字符串。 */
export type SemVerRange = string;

/**
 * 插件类型系统（决策 A1，RFC plugin-manifest-lifecycle §1）。当前主要类型为
 * 'frontend-response'。开放枚举：未知值应视为"将插件视为不透明但仍可安装"。
 */
export type PluginType =
  | 'frontend-response'
  | 'backend-tool-only'
  | 'llm-adapter'
  | 'storage-provider'
  | 'mcp-server-only'
  | 'agent-preset'
  | (string & {});

// ---------------------------------------------------------------------------
// 生命周期状态（状态机）
// ---------------------------------------------------------------------------

/**
 * 插件经历的七个生命周期状态（RFC plugin-manifest-lifecycle 状态机，
 * 形式化见 plugin.lifecycle-event.schema.json）：
 * discovered -> downloaded -> verified -> installed；enabled <-> disabled；uninstalled。
 */
export type LifecycleState =
  | 'discovered'
  | 'downloaded'
  | 'verified'
  | 'installed'
  | 'enabled'
  | 'disabled'
  | 'uninstalled';

/** 导致生命周期转换的谁或什么。 */
export type LifecycleTrigger =
  | 'user'
  | 'system'
  | 'dependency'
  | 'rollback';

// ---------------------------------------------------------------------------
// 权限（最小权限）
// ---------------------------------------------------------------------------

/**
 * 文件系统权限作用域。路径均相对于 $PLUGINS_DIR/<plugin_id>/ 解释；
 * 空数组或缺失表示无该类访问。
 */
export interface FilesystemPermissions {
  /** 插件可读取的 glob 模式，相对于其沙箱。 */
  read?: string[];
  /** 插件可写入的 glob 模式，相对于其沙箱。 */
  write?: string[];
}

/** 清单中声明的能力权限。省略时每个字段默认为最受限的值。 */
export interface PluginPermissions {
  /** 插件可以注册后端工具执行器。 */
  tools?: boolean;
  /** 插件可以打开出站网络套接字。 */
  network?: boolean;
  /** 文件系统读写作用域。 */
  filesystem?: FilesystemPermissions;
  /** 插件可以派生子进程（对 Tier 3 是隐含的）。 */
  childProcess?: boolean;
  /** 插件可读取的环境变量名允许列表。 */
  envVars?: string[];
}

// ---------------------------------------------------------------------------
// 能力块（`provides` 对象）
// ---------------------------------------------------------------------------

/** 插件内嵌的 MCP 服务引用。 */
export interface McpServerRef {
  id: string;
  /** 当前仅 'stdio' 生产支持；'http' 保留。 */
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
}

/** 插件包中 skills/ 下的 skill 文件引用。 */
export interface SkillRef {
  /** 匹配 `skills/*.md` 的相对路径。 */
  path: string;
}

/** rules/ 下确定性规则文件的引用。 */
export interface RuleRef {
  /** 匹配 `rules/*.(md|txt)` 的相对路径。 */
  path: string;
}

/** 提供给 iframe+CSP 沙箱的前端打包产物入口（决策 A2）。 */
export interface FrontendEntry {
  /** HTML 入口，通常为 `frontend/index.html`。 */
  entry: string;
  /** iframe 的可选 Content-Security-Policy 头值。 */
  csp?: string;
}

/** Context Provider 引用（MAY 扩展点，决策 A3）。 */
export interface ContextProviderRef {
  id: string;
}

/** Memory Backend 引用（MAY 扩展点，决策 A3）。 */
export interface MemoryBackendRef {
  id: string;
}

/**
 * 插件贡献的能力集合。至少一个块必须非空（JSON Schema 通过对非空数组 /
 * 存在的 `frontendEntry` 使用 `oneOf` 强制此要求）。
 */
export interface PluginProvides {
  mcpServers?: McpServerRef[];
  skills?: SkillRef[];
  rules?: RuleRef[];
  frontendEntry?: FrontendEntry;
  contextProviders?: ContextProviderRef[];
  memoryBackends?: MemoryBackendRef[];
}

// ---------------------------------------------------------------------------
// 引擎兼容性、依赖、钩子
// ---------------------------------------------------------------------------

/** 宿主引擎（MyCopilot server）版本约束。 */
export interface EngineCompatibility {
  /** 插件可运行的最低宿主版本（SemVer）。 */
  minVersion: SemVer;
  /** 可选上界（开区间，npm 风格范围）。 */
  maxVersion?: SemVerRange;
}

/** 作者或维护者。 */
export interface Author {
  name: string;
  email?: string;
  url?: string;
}

/** 插件依赖，安装时按名称 + semver 范围解析。 */
export interface PluginDependency {
  name: PluginId;
  versionRange: SemVerRange;
}

/** 在生命周期转换时调用的入口点。 */
export interface HookEntry {
  command: string;
  /** 钩子超时，默认 5000ms（见 RFC §10 性能预算）。 */
  timeoutMs?: number;
}

/** 可选的生命周期钩子入口点。 */
export interface LifecycleHooks {
  onInstall?: HookEntry;
  onUninstall?: HookEntry;
  onEnable?: HookEntry;
}

// ---------------------------------------------------------------------------
// 清单聚合
// ---------------------------------------------------------------------------

/**
 * 插件清单（plugin.json）。精确镜像 docs/rfc/schemas/plugin.manifest.schema.json。
 * 九个必需字段（name、version、description、author、license、
 * engineCompatibility、source、permissions、provides）在此也是必填的。
 */
export interface PluginManifest {
  name: PluginId;
  version: SemVer;
  description: string;
  author: Author;
  /** SPDX 许可证标识符。 */
  license: string;
  homepage?: string;
  icon?: string;
  keywords?: string[];
  engineCompatibility: EngineCompatibility;
  source: PluginSource;
  permissions: PluginPermissions;
  provides: PluginProvides;
  dependencies?: PluginDependency[];
  lifecycleHooks?: LifecycleHooks;
  /** 可选的显式插件类型；默认为 'frontend-response'（决策 A1）。 */
  type?: PluginType;
}

// ---------------------------------------------------------------------------
// 生命周期事件记录
// ---------------------------------------------------------------------------

/** 生命周期转换尝试的结果。 */
export interface TransitionResult {
  status: 'success' | 'failed';
  /** 失败时的稳定错误码（例如 'signature_invalid'）。 */
  errorCode?: string;
  errorMessage?: string;
}

/** 插件生命周期事件日志的一行。 */
export interface PluginLifecycleEvent {
  eventId: string;
  type: LifecycleState;
  pluginId: PluginId;
  version: SemVer;
  timestamp: number;
  /** 本事件之前的状态；首次转换为 null。 */
  fromState: LifecycleState | null;
  toState: LifecycleState;
  trigger: LifecycleTrigger;
  result: TransitionResult;
  /** 可选的结构化 payload（摘要、错误详情等）。 */
  payload?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 状态归属（决策 A5）
// ---------------------------------------------------------------------------

/**
 * 暴露给插件的公开 store API（决策 A5）。由 SQLite
 * `plugin_data(plugin_id, key, value, created_at, updated_at)` 表支撑，
 * 读写按调用插件的 id 自动加作用域。
 */
export interface PluginStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}

/** 宿主强制执行的性能预算（RFC plugin-manifest-lifecycle §10）。 */
export interface PluginPerformanceBudget {
  /** 工具调用默认超时（ms）。默认 30000。 */
  toolCallTimeoutMs: number;
  /** 生命周期钩子默认超时（ms）。默认 5000。 */
  lifecycleHookTimeoutMs: number;
  /** 插件启动默认超时（ms）。默认 10000。 */
  startupTimeoutMs: number;
}

/**
 * PluginPerformanceBudget 的解析默认值（RFC plugin-manifest-lifecycle §10：
 * 工具调用 30000ms、生命周期钩子 5000ms、插件启动 10000ms）。
 */
export const DEFAULT_PLUGIN_BUDGET: PluginPerformanceBudget = {
  toolCallTimeoutMs: 30000,
  lifecycleHookTimeoutMs: 5000,
  startupTimeoutMs: 10000,
};
