import type { CapabilitySource, CapabilityState, ModelCapabilities } from '@my-copilot/shared'

/** 来源徽标文案（设计 UX 章节的手动/探测/目录/未知；provider 来源细化为"服务方"）。 */
export const VISION_SOURCE_LABELS: Record<CapabilitySource, string> = {
  manual: '手动',
  probe: '探测',
  catalog: '目录',
  provider: '服务方',
}

/** 三态文案。 */
export const VISION_STATE_LABELS: Record<CapabilityState, string> = {
  yes: '支持',
  no: '不支持',
  unknown: '未知',
}

export interface VisionCapabilityInfo {
  vision: CapabilityState
  source?: CapabilitySource
  /** 组合徽标文案，如 "支持·探测"；无来源时仅状态词（"未知"）。 */
  label: string
}

/** 从 ModelCapabilities 派生三态 + 来源 + 徽标文案（缺省 = unknown）。 */
export function describeVisionCapability(caps: ModelCapabilities | undefined): VisionCapabilityInfo {
  const vision = caps?.vision ?? 'unknown'
  const source = caps?.sources?.vision
  const label = source ? `${VISION_STATE_LABELS[vision]}·${VISION_SOURCE_LABELS[source]}` : VISION_STATE_LABELS[vision]
  return { vision, source, label }
}
