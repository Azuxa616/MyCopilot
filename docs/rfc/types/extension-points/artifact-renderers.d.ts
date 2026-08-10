/**
 * Artifact Renderers Extension Point - TypeScript 类型。
 *
 * 自包含模块：无 import。可用
 * `tsc --noEmit docs/rfc/types/extension-points/artifact-renderers.d.ts` 独立通过类型检查。
 *
 * 镜像 docs/rfc/schemas/extension-points/artifact-renderers.schema.json。
 *
 * 头条 MUST 扩展点（决策 A3），决策 B7 要求完整的 iframe+CSP 沙箱规范；
 * 完整的 Artifact 数据模型延后到未来工作。
 */

/** renderer 声明的 artifact “kind”。开放尾用于向前兼容。 */
export type ArtifactKind =
  | 'card'
  | 'iframe'
  | 'image'
  | 'table'
  | (string & {});

/** renderer 的外部地址：`pluginId:rendererName`。 */
export type NamespacedRendererId = string;

/** 触发 renderer 的、由 LLM 产出的指令（决策 B6）。 */
export interface ArtifactRenderRequest {
  /** 全限定 renderer id `pluginId:rendererName`。 */
  rendererId: NamespacedRendererId;
  /** renderer 声明的逻辑 kind。 */
  kind: ArtifactKind;
  /** 由 renderer 解释的不透明 payload；host 永不检视。 */
  payload: Record<string, unknown>;
  /** 显示在已渲染 artifact 上方的可选 title。 */
  title?: string;
}

/**
 * host 注册的 renderer 描述符。host 永不直接 import
 * React 组件；而是把 `bundleUrl` 加载进
 * iframe + CSP 沙箱（决策 A2）。
 */
export interface ArtifactRenderer {
  /** 稳定的 id；外部以 `pluginId:rendererId` 形式出现。 */
  id: string;
  /** 本 renderer 处理的 kind。 */
  kind: ArtifactKind;
  /**
   * 沙箱化 bundle 的绝对 URL。必须由 host
   * origin 或 CSP 白名单中的 origin 提供。bundle 通过
   * postMessage 接收 payload，并在 iframe 内渲染。
   */
  bundleUrl: string;
  /** 应用于 iframe 文档的可选 CSP 头。 */
  csp?: string;
}

/** host 为每个 renderer 强制执行的沙箱配置。 */
export interface ArtifactSandboxPolicy {
  /** iframe sandbox token；默认拒绝 scripts 与 same-origin 组合。 */
  sandbox: string[];
  /** 必需的 CSP 指令；默认值禁止 same-origin + eval。 */
  csp: string;
  /** 允许的 postMessage origin 列表；拒绝 '*'。 */
  allowedOrigins: string[];
  /** 以字节计的 payload 最大尺寸。默认 1_048_576。 */
  maxPayloadBytes: number;
}

/** host 与沙箱化 iframe 之间交换的通道消息类型。 */
export type ArtifactSandboxMessage =
  | { type: 'render'; requestId: string; payload: Record<string, unknown> }
  | { type: 'rendered'; requestId: string; height?: number }
  | { type: 'error'; requestId: string; message: string };

/** 一次 render 握手的预算。 */
export interface ArtifactRendererBudget {
  /** 从 `render` 到 `rendered` postMessage 的最大 ms 数。默认 10000。 */
  renderTimeoutMs: number;
  /** iframe 每条消息回传的最大字节数。默认 65536。 */
  maxPostMessageBytes: number;
}

export declare const DEFAULT_ARTIFACT_RENDERER_BUDGET: ArtifactRendererBudget;
export declare const DEFAULT_ARTIFACT_SANDBOX: ArtifactSandboxPolicy;
