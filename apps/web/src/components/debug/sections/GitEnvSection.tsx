// GitEnvSection — Debug modal section 1.
//
// Surfaces git metadata (branch / commit / describe / dirty) produced by the
// Vite `buildInfoPlugin`, plus a few client-side environment facts (Vite mode,
// build timestamp, web package version). Build info is cached by `getBuildInfo`
// after the first read, so re-rendering is cheap.

import { getBuildInfo } from '../../../utils/build-info'
// Four levels up from `src/components/debug/sections/` lands at `apps/web/`.
import webPackageJson from '../../../../package.json'

const WEB_VERSION: string = webPackageJson.version ?? 'unknown'

/** Format an ISO8601 build time for display; pass through unknown formats. */
function formatBuildTime(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

/** Trim a commit hash to the conventional 7-character short form. */
function shortCommit(hash: string | null): string {
  if (!hash) return '—'
  return hash.slice(0, 7)
}

const DT_CLASS = 'text-text-tertiary font-medium'
const DD_CLASS = 'font-mono text-text-secondary break-all'

export default function GitEnvSection() {
  // Read at render time. `getBuildInfo` caches after the first call, so this
  // is cheap — and keeping it out of module scope makes the component trivial
  // to test under different build-info states.
  const buildInfo = getBuildInfo()
  const git = buildInfo.git
  const branch = git?.branch ?? null
  const commit = git?.commit ?? null
  const commitDate = git?.commitDate ?? null
  const describe = git?.describe ?? null
  const dirty = git?.dirty ?? false
  const isDirtyDescribe = describe ? describe.includes('-dirty') : false

  return (
    <section data-testid="debug-git-env-section">
      <h4 className="text-sm font-semibold text-text-primary mb-1.5">
        Git &amp; Environment
      </h4>
      <p className="text-xs text-text-tertiary mb-2">
        Version, commit, and build environment details.
      </p>

      <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-xs">
        {/* —— Git metadata —— */}
        <dt className={DT_CLASS}>Branch</dt>
        <dd className={DD_CLASS} data-testid="git-env-branch">
          {branch ?? '(detached HEAD)'}
        </dd>

        <dt className={DT_CLASS}>Commit</dt>
        <dd className={DD_CLASS} data-testid="git-env-commit">
          {shortCommit(commit)}
        </dd>

        <dt className={DT_CLASS}>Commit Date</dt>
        <dd className={DD_CLASS} data-testid="git-env-commit-date">
          {commitDate ?? '—'}
        </dd>

        <dt className={DT_CLASS}>Describe</dt>
        <dd
          className={`font-mono break-all ${
            isDirtyDescribe ? 'text-error-dark font-semibold' : 'text-text-secondary'
          }`}
          data-testid="git-env-describe"
        >
          {describe ?? '—'}
        </dd>

        <dt className={DT_CLASS}>Dirty</dt>
        <dd className="font-mono" data-testid="git-env-dirty">
          {git ? (
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                dirty
                  ? 'bg-error-light text-error-dark'
                  : 'bg-success-light text-success-dark'
              }`}
            >
              {dirty ? 'dirty' : 'clean'}
            </span>
          ) : (
            <span className="text-text-tertiary">—</span>
          )}
        </dd>

        {/* —— Environment —— */}
        <dt className={`${DT_CLASS} pt-2 mt-1 border-t border-border-light`}>Mode</dt>
        <dd
          className={`${DD_CLASS} pt-2 mt-1 border-t border-border-light`}
          data-testid="git-env-mode"
        >
          {import.meta.env.MODE}
        </dd>

        <dt className={DT_CLASS}>Build Time</dt>
        <dd className={DD_CLASS} data-testid="git-env-build-time">
          {formatBuildTime(buildInfo.buildTime)}
        </dd>

        <dt className={DT_CLASS}>Web Version</dt>
        <dd className={DD_CLASS} data-testid="git-env-web-version">
          {WEB_VERSION}
        </dd>
      </dl>

      {buildInfo.note && (
        <p className="mt-2 text-[11px] italic text-text-tertiary">{buildInfo.note}</p>
      )}
    </section>
  )
}
