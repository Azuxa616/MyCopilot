// PluginsPage.test.tsx — Tests for the plugins management settings page.
//
// Uses vi.hoisted + vi.mock to control what `api.fetchPlugins()` returns, so we
// can exercise the empty state and the conditional button matrix across plugin
// source/state combinations.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactElement } from 'react'
import type {
  PluginRecord,
  PluginSource,
  LifecycleState,
} from '@my-copilot/shared'

// `vi.hoisted` runs before `vi.mock`'s factory is evaluated, so the factory can
// safely close over `fetchPluginsMock`.
const { fetchPluginsMock } = vi.hoisted(() => ({
  fetchPluginsMock: vi.fn(),
}))

vi.mock('../../../api', () => ({
  api: {
    fetchPlugins: fetchPluginsMock,
    installPlugin: vi.fn(),
    enablePlugin: vi.fn(),
    disablePlugin: vi.fn(),
    uninstallPlugin: vi.fn(),
    fetchPluginEvents: vi.fn(),
  },
}))

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Mounts a React element and flushes the async load effect (fetchPlugins). */
async function renderAsync(ui: ReactElement): Promise<{
  container: HTMLElement
  unmount: () => void
}> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(ui)
  })
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

/** Builds a minimal PluginRecord; id/source/state are the interesting axes. */
function makePlugin(overrides: {
  id: string
  source: PluginSource
  state: LifecycleState
}): PluginRecord {
  return {
    id: overrides.id,
    version: '1.0.0',
    source: overrides.source,
    state: overrides.state,
    type: 'frontend-response',
    manifest: {
      name: overrides.id,
      version: '1.0.0',
      description: `${overrides.id} 的测试清单`,
      author: { name: 'tester' },
      license: 'MIT',
      engineCompatibility: { minVersion: '1.0.0' },
      source: overrides.source,
      permissions: {},
      provides: { skills: [{ path: 'skills/demo.md' }] },
    },
    digest: '0123456789abcdef',
    directory: overrides.id,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  }
}

/** Finds a plugin row by its data-testid. */
function getRow(container: HTMLElement, id: string): HTMLElement {
  const row = container.querySelector(`[data-testid="plugin-${id}"]`)
  if (!row) throw new Error(`plugin row "${id}" not found`)
  return row as HTMLElement
}

/** Finds a button inside a row by its visible label; null when absent. */
function getButton(row: HTMLElement, label: string): HTMLButtonElement | null {
  const btn = Array.from(row.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label,
  )
  return btn ? (btn as HTMLButtonElement) : null
}

// Import AFTER vi.mock so the component picks up the mocked api.
import { PluginsPage } from '../PluginsPage'

describe('PluginsPage', () => {
  beforeEach(() => {
    fetchPluginsMock.mockReset()
    document.body.innerHTML = ''
  })

  it('shows the empty state when there are no plugins', async () => {
    fetchPluginsMock.mockResolvedValue([])
    const { container, unmount } = await renderAsync(<PluginsPage />)

    expect(fetchPluginsMock).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('插件管理')
    expect(container.textContent).toContain('暂无插件')

    // 安装插件主按钮仍然可用
    const installBtn = Array.from(
      container.querySelectorAll('button'),
    ).find((b) => b.textContent?.trim() === '安装插件')
    expect(installBtn).toBeDefined()

    unmount()
  })

  it('renders the conditional action buttons per source/state combination', async () => {
    fetchPluginsMock.mockResolvedValue([
      makePlugin({ id: 'p-enabled', source: 'official', state: 'enabled' }),
      makePlugin({ id: 'p-community', source: 'community', state: 'installed' }),
      makePlugin({ id: 'p-uninstalled', source: 'community', state: 'uninstalled' }),
    ])
    const { container, unmount } = await renderAsync(<PluginsPage />)

    // enabled official：有可用的「禁用」，无「启用」；official 不提供「卸载」
    const enabledRow = getRow(container, 'p-enabled')
    const disableBtn = getButton(enabledRow, '禁用')
    expect(disableBtn).not.toBeNull()
    expect(disableBtn!.disabled).toBe(false)
    expect(getButton(enabledRow, '启用')).toBeNull()
    expect(getButton(enabledRow, '卸载')).toBeNull()
    expect(getButton(enabledRow, '事件')).not.toBeNull()

    // installed community：「启用」可用（插件外部化 §5：信任决策交给确认框）；「卸载」可用
    const communityRow = getRow(container, 'p-community')
    const enableBtn = getButton(communityRow, '启用')
    expect(enableBtn).not.toBeNull()
    expect(enableBtn!.disabled).toBe(false)
    const uninstallBtn = getButton(communityRow, '卸载')
    expect(uninstallBtn).not.toBeNull()
    expect(uninstallBtn!.disabled).toBe(false)

    // uninstalled community：仅「事件」
    const uninstalledRow = getRow(container, 'p-uninstalled')
    const buttons = Array.from(uninstalledRow.querySelectorAll('button'))
    expect(buttons.length).toBe(1)
    expect(buttons[0]!.textContent?.trim()).toBe('事件')

    // 状态徽章配色：enabled 绿、uninstalled 红
    expect(
      getRow(container, 'p-enabled').textContent?.includes('enabled'),
    ).toBe(true)
    const badges = getRow(container, 'p-uninstalled').querySelectorAll('span')
    const stateBadge = Array.from(badges).find(
      (s) => s.textContent?.trim() === 'uninstalled',
    )
    expect(stateBadge?.className).toContain('bg-red-100')

    unmount()
  })
})
