import { useCallback, useMemo, useState } from 'react'
import { api } from '../../../api'
import { describeVisionCapability } from '../../../utils/capability'
import type { Model } from '@my-copilot/shared'

export type { VisionCapabilityInfo } from '../../../utils/capability'

export type SetVisionValue = 'yes' | 'no' | null

/**
 * 模型图片输入能力的消费入口（设计"UX 三段式防御"的数据源）。
 *
 * 传入当前生效模型（DIY agent 链路上为最终生效模型——设计"与现有系统的咬合"），
 * 返回三态/来源/徽标文案与两个动作；动作成功后本地快照服务端返回的最新 Model，
 * 外部切换模型（id 变化）时快照自动失效。
 *
 * Sender 侧门控（事前置灰/事中警告/事后提示）由后续任务接线，本 hook
 * 只负责数据与动作。
 */
export function useModelVisionCapability(model: Model | undefined) {
  const [snapshot, setSnapshot] = useState<Model | null>(null)
  const [isProbing, setIsProbing] = useState(false)

  const effective = snapshot && model && snapshot.id === model.id ? snapshot : model
  const info = useMemo(() => describeVisionCapability(effective?.capabilities), [effective])

  const probe = useCallback(async () => {
    if (!effective) throw new Error('No model selected')
    setIsProbing(true)
    try {
      const { model: updated } = await api.probeModelVision(effective.id)
      setSnapshot(updated)
      return updated
    } finally {
      setIsProbing(false)
    }
  }, [effective])

  const setVision = useCallback(async (vision: SetVisionValue) => {
    if (!effective) throw new Error('No model selected')
    const updated = await api.setModelVision(effective.id, vision)
    setSnapshot(updated)
    return updated
  }, [effective])

  return {
    model: effective,
    vision: info.vision,
    source: info.source,
    label: info.label,
    isProbing,
    probe,
    setVision,
  }
}
