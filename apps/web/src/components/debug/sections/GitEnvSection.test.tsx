// GitEnvSection.test.tsx — Tests for the debug modal's Git & Environment section.
//
// Uses vi.hoisted + vi.mock to control what `getBuildInfo()` returns, so we can
// exercise both the "git unavailable" fallback path and a realistic populated
// build-info (including the -dirty warning highlight).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactElement } from 'react'
import type { BuildInfo } from '@my-copilot/shared'

// `vi.hoisted` runs before `vi.mock`'s factory is evaluated, so the factory can
// safely close over `buildInfoHolder`.
const { buildInfoHolder } = vi.hoisted(() => ({
  buildInfoHolder: { current: null as BuildInfo | null },
}))

vi.mock('../../../utils/build-info', () => ({
  getBuildInfo: () => buildInfoHolder.current,
}))

// React 19 requires this flag for act() to work correctly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const FALLBACK: BuildInfo = {
  git: null,
  buildTime: '',
  note: 'not built yet',
}

/** Minimal render helper — mounts a React element into jsdom and returns the container. */
function render(ui: ReactElement): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
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

// Import AFTER vi.mock so the component picks up the mocked getBuildInfo.
import GitEnvSection from './GitEnvSection'

describe('GitEnvSection', () => {
  beforeEach(() => {
    buildInfoHolder.current = FALLBACK
    document.body.innerHTML = ''
  })

  it('renders the section heading and description', () => {
    const { container, unmount } = render(<GitEnvSection />)

    const heading = container.querySelector('h4')
    expect(heading).not.toBeNull()
    expect(heading!.textContent).toBe('Git & Environment')

    const description = container.querySelector('p')
    expect(description).not.toBeNull()
    expect(description!.textContent).toContain('Version, commit, and build environment details')

    unmount()
  })

  it('renders all expected field labels', () => {
    const { container, unmount } = render(<GitEnvSection />)

    const labels = Array.from(container.querySelectorAll('dt')).map(
      (dt) => dt.textContent?.trim() ?? '',
    )
    expect(labels).toEqual([
      'Branch',
      'Commit',
      'Commit Date',
      'Describe',
      'Dirty',
      'Mode',
      'Build Time',
      'Web Version',
    ])

    unmount()
  })

  describe('fallback (git unavailable)', () => {
    it('shows "(detached HEAD)" for branch when git is null', () => {
      const { container, unmount } = render(<GitEnvSection />)

      const branch = container.querySelector('[data-testid="git-env-branch"]')
      expect(branch!.textContent).toBe('(detached HEAD)')

      unmount()
    })

    it('shows "—" for commit, commit date, and describe when git is null', () => {
      const { container, unmount } = render(<GitEnvSection />)

      expect(container.querySelector('[data-testid="git-env-commit"]')!.textContent).toBe('—')
      expect(container.querySelector('[data-testid="git-env-commit-date"]')!.textContent).toBe('—')
      expect(container.querySelector('[data-testid="git-env-describe"]')!.textContent).toBe('—')

      unmount()
    })

    it('shows "—" for dirty when git is null', () => {
      const { container, unmount } = render(<GitEnvSection />)

      const dirty = container.querySelector('[data-testid="git-env-dirty"]')
      expect(dirty!.textContent).toBe('—')

      unmount()
    })

    it('shows "—" for build time when empty', () => {
      const { container, unmount } = render(<GitEnvSection />)

      const buildTime = container.querySelector('[data-testid="git-env-build-time"]')
      expect(buildTime!.textContent).toBe('—')

      unmount()
    })

    it('shows the "not built yet" note', () => {
      const { container, unmount } = render(<GitEnvSection />)

      expect(container.textContent).toContain('not built yet')

      unmount()
    })
  })

  describe('environment fields', () => {
    it('shows the current Vite MODE', () => {
      const { container, unmount } = render(<GitEnvSection />)

      // In vitest, import.meta.env.MODE is 'test'.
      const mode = container.querySelector('[data-testid="git-env-mode"]')
      expect(mode!.textContent).toBe(import.meta.env.MODE)

      unmount()
    })

    it('shows the web package version', () => {
      const { container, unmount } = render(<GitEnvSection />)

      const version = container.querySelector('[data-testid="git-env-web-version"]')
      // The version must be a non-empty string matching the web package.json.
      expect(typeof version!.textContent).toBe('string')
      expect(version!.textContent!.length).toBeGreaterThan(0)
      // Sanity: must look like a semver-ish string.
      expect(version!.textContent).toMatch(/^\d+\.\d+\.\d+/)

      unmount()
    })
  })

  describe('populated build info', () => {
    const populatedBuildInfo: BuildInfo = {
      git: {
        branch: 'feature/test-branch',
        commit: 'abcdef1234567890',
        commitDate: '2026-01-15T10:30:00Z',
        describe: 'v1.2.3',
        dirty: false,
      },
      buildTime: '2026-01-15T11:00:00Z',
    }

    it('renders branch and commit short hash', () => {
      buildInfoHolder.current = populatedBuildInfo
      const { container, unmount } = render(<GitEnvSection />)

      expect(container.querySelector('[data-testid="git-env-branch"]')!.textContent).toBe(
        'feature/test-branch',
      )
      // Commit must be sliced to 7 chars.
      expect(container.querySelector('[data-testid="git-env-commit"]')!.textContent).toBe(
        'abcdef1',
      )

      unmount()
    })

    it('renders a "clean" badge when dirty is false', () => {
      buildInfoHolder.current = populatedBuildInfo
      const { container, unmount } = render(<GitEnvSection />)

      const dirty = container.querySelector('[data-testid="git-env-dirty"]')
      expect(dirty!.textContent).toBe('clean')

      unmount()
    })

    it('renders describe without error highlight when not dirty', () => {
      buildInfoHolder.current = populatedBuildInfo
      const { container, unmount } = render(<GitEnvSection />)

      const describe = container.querySelector('[data-testid="git-env-describe"]')
      expect(describe!.textContent).toBe('v1.2.3')
      expect(describe!.className).not.toContain('text-error-dark')

      unmount()
    })
  })

  describe('dirty working tree', () => {
    const dirtyBuildInfo: BuildInfo = {
      git: {
        branch: 'main',
        commit: '1234567890abcdef',
        commitDate: '2026-02-01T00:00:00Z',
        describe: 'v1.0.0-2-g1234567-dirty',
        dirty: true,
      },
      buildTime: '2026-02-01T01:00:00Z',
    }

    it('applies red highlight to describe when it contains "-dirty"', () => {
      buildInfoHolder.current = dirtyBuildInfo
      const { container, unmount } = render(<GitEnvSection />)

      const describe = container.querySelector('[data-testid="git-env-describe"]')
      expect(describe!.textContent).toBe('v1.0.0-2-g1234567-dirty')
      expect(describe!.className).toContain('text-error-dark')

      unmount()
    })

    it('renders a "dirty" badge when dirty is true', () => {
      buildInfoHolder.current = dirtyBuildInfo
      const { container, unmount } = render(<GitEnvSection />)

      const dirty = container.querySelector('[data-testid="git-env-dirty"]')
      expect(dirty!.textContent).toBe('dirty')

      unmount()
    })

    it('renders "(detached HEAD)" when branch is null but git is present', () => {
      buildInfoHolder.current = {
        git: {
          branch: null,
          commit: 'deadbeef',
          commitDate: null,
          describe: null,
          dirty: false,
        },
        buildTime: '',
      }
      const { container, unmount } = render(<GitEnvSection />)

      expect(container.querySelector('[data-testid="git-env-branch"]')!.textContent).toBe(
        '(detached HEAD)',
      )

      unmount()
    })
  })
})
