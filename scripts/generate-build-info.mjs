#!/usr/bin/env node

/**
 * Generate build-info JSON containing git metadata for the debug panel.
 *
 * Design goals:
 *  - Fail-soft: NEVER crashes the build. If git is unavailable, not installed,
 *    or the cwd is not a repository, writes `{ git: null, buildTime, note }`
 *    and exits 0.
 *  - Zero dependencies: uses only Node builtins (child_process, fs, path).
 *  - Dual-purpose: runnable as a CLI (`node ... --output <path>`) AND importable
 *    (Vite plugin imports `generateBuildInfo()` directly).
 *
 * Usage (CLI):
 *   node scripts/generate-build-info.mjs --output apps/web/src/build-info.generated.json
 *
 * Usage (import):
 *   import { generateBuildInfo } from './generate-build-info.mjs'
 *   generateBuildInfo('/abs/path/to/build-info.generated.json')
 *
 * Output schema (must match `BuildInfo` in packages/shared/src/debug.ts):
 *   {
 *     git: {
 *       branch: string | null,     // null on detached HEAD
 *       commit: string | null,     // full SHA
 *       commitDate: string | null, // ISO 8601 author/commit date
 *       describe: string | null,   // `git describe --tags --always --dirty`
 *       dirty: boolean             // true if working tree has uncommitted changes
 *     } | null,                    // null when git entirely unavailable
 *     buildTime: string,           // ISO 8601 generation timestamp
 *     note?: string                // human-readable context (detached / unavailable / ...)
 *   }
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// TODO: replace with shared import once T1 (packages/shared/src/debug.ts) lands.
// Kept here as JSDoc so the .mjs stays dependency-free and self-documenting.
/**
 * @typedef {Object} GitInfo
 * @property {string | null} branch
 * @property {string | null} commit
 * @property {string | null} commitDate
 * @property {string | null} describe
 * @property {boolean} dirty
 *
 * @typedef {Object} BuildInfo
 * @property {GitInfo | null} git
 * @property {string} buildTime
 * @property {string} [note]
 */

const GIT_UNAVAILABLE_NOTE = 'git unavailable';
const SCRIPT_FILENAME = 'generate-build-info.mjs';

/**
 * Run a git subcommand, returning trimmed stdout. Throws on non-zero exit
 * (caller is responsible for try/catch). stderr is piped to suppress noise
 * from expected failures (e.g. "fatal: not a git repository").
 *
 * @param {string} args - git arguments (without the leading `git`).
 * @returns {string} trimmed stdout.
 */
function runGit(args) {
  return execSync(`git ${args}`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: process.cwd(),
  }).trim();
}

/**
 * Extract a clean detail string from an execSync error (prefers stderr).
 * @param {unknown} err
 * @returns {string}
 */
function gitErrorDetail(err) {
  if (err && typeof err === 'object' && 'stderr' in err && err.stderr) {
    const s = String(err.stderr).trim();
    if (s) return s;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Collect git metadata. Returns `{ git, note }` where `git` is null when git
 * is entirely unavailable, or a full GitInfo object otherwise. Individual
 * fields degrade to null if a specific subcommand fails.
 *
 * @returns {{ git: GitInfo | null, note?: string }}
 */
function collectGitInfo() {
  // Probe with the commit hash: if this fails, git is effectively unusable
  // (not installed / not a repo / no commits). Treat the whole git block as
  // null per the fail-soft contract.
  let commit;
  try {
    commit = runGit('rev-parse HEAD');
    if (!commit) throw new Error('git returned empty commit hash');
  } catch (err) {
    return { git: null, note: `${GIT_UNAVAILABLE_NOTE}: ${gitErrorDetail(err)}` };
  }

  // branch: `git rev-parse --abbrev-ref HEAD` returns literal "HEAD" when
  // detached. Normalize that to null and annotate.
  let branch = null;
  const notes = [];
  try {
    const raw = runGit('rev-parse --abbrev-ref HEAD');
    if (!raw || raw === 'HEAD') {
      branch = null;
      notes.push('detached HEAD');
    } else {
      branch = raw;
    }
  } catch {
    branch = null;
  }

  // commitDate: ISO 8601 of the latest commit (%cI = committer date, strict ISO).
  let commitDate = null;
  try {
    commitDate = runGit('log -1 --format=%cI') || null;
  } catch {
    commitDate = null;
  }

  // describe: often fails when there are no tags — that's fine, degrade to null.
  let describe = null;
  try {
    describe = runGit('describe --tags --always --dirty=-dirty') || null;
  } catch {
    describe = null;
  }

  // dirty: non-empty porcelain output means uncommitted changes.
  let dirty = false;
  try {
    const status = runGit('status --porcelain');
    dirty = status.length > 0;
  } catch {
    dirty = false;
  }

  /** @type {GitInfo} */
  const git = { branch, commit, commitDate, describe, dirty };
  const note = notes.length > 0 ? notes.join('; ') : undefined;
  return { git, note };
}

/**
 * Generate build-info JSON and write it to `outputPath`.
 *
 * @param {string} outputPath - absolute or cwd-relative destination path.
 * @returns {BuildInfo} the object that was written (for callers that want it).
 */
export function generateBuildInfo(outputPath) {
  const outPath = resolve(process.cwd(), outputPath);
  const { git, note } = collectGitInfo();
  const buildTime = new Date().toISOString();

  /** @type {BuildInfo} */
  const info = { git, buildTime };
  if (note) info.note = note;

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(info, null, 2)}\n`, 'utf-8');
  return info;
}

// ── CLI entry ──────────────────────────────────────────────────────────────
// Detected via argv[1] suffix (import.meta.url intentionally avoided per the
// task constraints; this keeps the .mjs usable both as a script and a module).
const invokedAs = process.argv[1] ?? '';
const isMain = invokedAs.endsWith(SCRIPT_FILENAME) || invokedAs.endsWith(`\\${SCRIPT_FILENAME}`) || invokedAs.endsWith(`/${SCRIPT_FILENAME}`);

if (isMain) {
  const args = process.argv.slice(2);
  let output = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--output' && i + 1 < args.length) {
      output = args[++i];
    } else if (a.startsWith('--output=')) {
      output = a.slice('--output='.length);
    } else if (a === '-h' || a === '--help') {
      process.stdout.write(
        'Usage: node scripts/generate-build-info.mjs --output <path>\n' +
          '  Writes git build metadata as JSON to <path>. Never fails the process.\n',
      );
      process.exit(0);
    }
  }

  if (!output) {
    console.error('[generate-build-info] Missing required --output <path> argument.');
    console.error('Usage: node scripts/generate-build-info.mjs --output <path>');
    process.exit(2);
  }

  try {
    const info = generateBuildInfo(output);
    const label = info.git ? `branch=${info.git.branch ?? '(detached)'}` : 'git=null';
    console.log(`[generate-build-info] wrote ${output} (${label})`);
  } catch (err) {
    // Last-resort fail-soft: generateBuildInfo already fail-softs git, but a
    // filesystem error (e.g. unwritable path) could still throw. Write a
    // minimal fallback so downstream importers never see a missing file.
    const fallback = {
      git: null,
      buildTime: new Date().toISOString(),
      note: `${GIT_UNAVAILABLE_NOTE}: ${err instanceof Error ? err.message : String(err)}`,
    };
    try {
      const outPath = resolve(process.cwd(), output);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, `${JSON.stringify(fallback, null, 2)}\n`, 'utf-8');
      console.error(`[generate-build-info] wrote fallback to ${output} (${fallback.note})`);
    } catch (writeErr) {
      // Absolutely cannot fail the build — log and exit 0 regardless.
      console.error(
        `[generate-build-info] could not write fallback: ${
          writeErr instanceof Error ? writeErr.message : String(writeErr)
        }`,
      );
    }
    // Always exit 0: build-info is best-effort, never a build-breaking concern.
  }
}
