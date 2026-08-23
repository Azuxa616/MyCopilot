/**
 * UI Panels Extension Point - TypeScript 类型。
 *
 * 自包含模块：无 import。可用
 * `tsc --noEmit docs/rfc/types/extension-points/ui-panels.d.ts` 独立通过类型检查。
 *
 * 镜像 docs/rfc/schemas/extension-points/ui-panels.schema.json。
 *
 * 这是唯一可以声明 React 假设的扩展点，
 * 与当前前端栈（apps/web/src, React 19 + Zustand）相匹配。
 * host 不会 import panel 组件；它们通过一个 slot registry
 * 挂载到具名 slot 中，从而让 host 不含插件代码。
 */

/** host 暴露的 slot。开放尾供未来 slot 使用。 */
export type UIPanelSlot =
  | 'sidebar'
  | 'toolbar'
  | 'message-action'
  | 'settings-tab'
  | (string & {});

/** panel 的外部地址：`pluginId:panelName`。 */
export type NamespacedPanelId = string;

/** panel 可请求的能力；每项默认为 false。 */
export interface UIPanelPermissions {
  /** panel 可以读取 active session id 和 history 长度。 */
  readSession?: boolean;
  /** panel 可以向 active session 投递一条 user message。 */
  postMessage?: boolean;
  /** panel 可以在新标签页打开一个 URL。 */
  openExternal?: boolean;
}

/** host 注册的静态描述符。 */
export interface UIPanelDescriptor {
  /** 稳定的 id；外部以 `pluginId:panelId` 形式出现。 */
  id: string;
  /** panel 挂载到的 slot。 */
  slot: UIPanelSlot;
  /** 在 host chrome 中展示的可读 label。 */
  label: string;
  /** 图标 URL 或 data URL；可选。 */
  iconUrl?: string;
  /** slot 内的排序；数值小者先运行。默认 100。 */
  order?: number;
  /** 在 manifest 中声明、在启用时授予的能力。 */
  permissions: UIPanelPermissions;
  /**
   * 懒加载的 module URL。host 用 dynamic import() 加载它，
   * 并期望得到一个 default export 的 React 组件。host 永不直接
   * import 插件源码。
   */
  moduleUrl: string;
}

/** slot registry：slot 名 -> 有序描述符的映射。 */
export interface UISlotRegistry {
  slot: UIPanelSlot;
  panels: UIPanelDescriptor[];
}

/** 动态 import 握手的预算。 */
export interface UIPanelBudget {
  /** dynamic import 完成解析的最大 ms 数。默认 5000。 */
  mountTimeoutMs: number;
  /** 每个 slot 的最大 panel 数。默认 8。 */
  maxPanelsPerSlot: number;
}

export declare const DEFAULT_UI_PANEL_BUDGET: UIPanelBudget;
