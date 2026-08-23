/**
 * verify-no-debug-in-prod.mjs
 *
 * Release gate: scans the web production bundle (apps/web/dist/) for any
 * debug-related symbols. Exits 0 if clean, 1 if any match is found.
 *
 * This ensures the double-gating (conditional lazy import + early return)
 * is working correctly and debug code never ships to end users.
 *
 * Usage:
 *   node scripts/verify-no-debug-in-prod.mjs
 *
 * Intended to be run as part of CI / pre-release checks, after `pnpm build`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DIST_DIR = resolve(REPO_ROOT, 'apps', 'web', 'dist');

/**
 * Patterns that must NEVER appear in the production bundle.
 * If any of these leak through, the debug tree-shaking is broken.
 */
const DEBUG_PATTERNS = [
  'DebugModal',
  'DebugBadge',
  'debugStore',
  'dev-badge',
  'GitEnvSection',
  'ApiConfigSection',
  'StoreSnapshotSection',
  'BackendRuntimeSection',
  'DebugEnvInfo',
  'MYCOPILOT_DEBUG',
];

/**
 * Recursively collect all files under `dir`.
 * @param {string} dir
 * @returns {string[]}
 */
function collectFiles(dir) {
  /** @type {string[]} */
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let st;
    try {
      st = statSync(fullPath);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      results.push(...collectFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function main() {
  // Verify dist directory exists
  let distStat;
  try {
    distStat = statSync(DIST_DIR);
  } catch {
    console.error(`[verify-no-debug-in-prod] dist directory not found: ${DIST_DIR}`);
    console.error('  Run `pnpm build` first.');
    process.exit(1);
  }

  if (!distStat.isDirectory()) {
    console.error(`[verify-no-debug-in-prod] dist path is not a directory: ${DIST_DIR}`);
    process.exit(1);
  }

  const files = collectFiles(DIST_DIR);
  if (files.length === 0) {
    console.error(`[verify-no-debug-in-prod] dist directory is empty: ${DIST_DIR}`);
    console.error('  Run `pnpm build` first.');
    process.exit(1);
  }

  /** @type {{ file: string, pattern: string }[]} */
  const violations = [];

  for (const file of files) {
    let content;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      // Skip files that can't be read (e.g. binary assets)
      continue;
    }
    for (const pattern of DEBUG_PATTERNS) {
      if (content.includes(pattern)) {
        violations.push({ file, pattern });
      }
    }
  }

  if (violations.length === 0) {
    console.log(
      `[verify-no-debug-in-prod] OK — scanned ${files.length} files in dist/, zero debug matches.`,
    );
    process.exit(0);
  }

  console.error(
    `[verify-no-debug-in-prod] FAIL — found ${violations.length} debug leak(s) in production bundle:`,
  );
  for (const { file, pattern } of violations) {
    const relative = file.replace(REPO_ROOT + '\\', '').replace(REPO_ROOT + '/', '');
    console.error(`  ✗ ${relative}: contains "${pattern}"`);
  }
  console.error('');
  console.error('Debug code is leaking into the production bundle.');
  console.error('Check that debug components use conditional lazy imports gated on import.meta.env.DEV.');
  process.exit(1);
}

main();
