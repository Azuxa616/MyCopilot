// 插件生命周期状态的徽章配色：enabled 绿 / disabled 灰 / installed 蓝 /
// discovered·downloaded·verified 黄（过渡态）/ uninstalled 红。PluginsPage 与 PluginEventsModal 共用。
import type { LifecycleState } from '@my-copilot/shared'

export const stateColorClass: Record<LifecycleState, string> = {
  enabled: 'bg-green-100 text-green-700',
  disabled: 'bg-gray-100 text-gray-600',
  installed: 'bg-blue-100 text-blue-700',
  discovered: 'bg-amber-100 text-amber-700',
  downloaded: 'bg-amber-100 text-amber-700',
  verified: 'bg-amber-100 text-amber-700',
  uninstalled: 'bg-red-100 text-red-700',
}
