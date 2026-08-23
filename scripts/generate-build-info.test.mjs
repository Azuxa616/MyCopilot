/**
 * Tests for generate-build-info.mjs.
 *
 * Uses Node's built-in `node:test` runner (zero extra dependencies).
 * Run with:  node --test scripts/generate-build-info.test.mjs
 *
 * Two key behaviors verified:
 *  1. Normal path: in a git repo, writes a BuildInfo JSON with non-null git
 *     block and ISO8601 buildTime.
 *  2. Fail-soft: when run in a directory with no `.git`, the process exits 0
 *     and writes `{ git: null, buildTime, note }`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, 'generate-build-info.mjs');
const ISO8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/**
 * Spawn the script as a subprocess and return { code, stdout, stderr, data }.
 * @param {string} cwd
 * @param {string} output
 */
function runScript(cwd, output) {
  const stdout = [];
  const stderr = [];
  let code;
  try {
    // execFileSync throws on non-zero exit; we capture code via the error.
    const out = execFileSync(process.execPath, [SCRIPT, '--output', output], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    code = 0;
    stdout.push(out ?? '');
  } catch (err) {
    code = err.status ?? 1;
    stdout.push(err.stdout ? err.stdout.toString() : '');
    stderr.push(err.stderr ? err.stderr.toString() : '');
  }
  let data = null;
  try {
    data = JSON.parse(readFileSync(output, 'utf-8'));
  } catch {
    data = null;
  }
  return { code, stdout: stdout.join(''), stderr: stderr.join(''), data };
}

test('normal path: writes BuildInfo with git info and ISO8601 buildTime', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildinfo-normal-'));
  try {
    const out = join(dir, 'out.json');
    // Run from the repo root so git commands resolve to the real repository.
    const { code, data } = runScript(process.cwd(), out);

    assert.equal(code, 0, 'script must exit 0 on success');
    assert.ok(data, 'output JSON must be parseable');
    assert.match(data.buildTime, ISO8601, 'buildTime must be ISO8601');

    // When the test runs inside the repo, git should be available.
    if (data.git !== null) {
      assert.equal(typeof data.git.dirty, 'boolean');
      if (data.git.commit !== null) {
        assert.match(
          data.git.commit,
          /^[0-9a-f]{7,}$/i,
          'commit must be a hex SHA (>=7 chars)',
        );
      }
      if (data.git.commitDate !== null) {
        assert.match(data.git.commitDate, ISO8601, 'commitDate must be ISO8601');
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fail-soft: no .git in cwd → git:null, exit 0, note present', () => {
  // Fresh temp dir guaranteed to have no .git anywhere up the tree (tmpdir is
  // outside the repo). Copy the script there and run it in-place.
  const dir = mkdtempSync(join(tmpdir(), 'buildinfo-nogit-'));
  try {
    const scriptCopy = join(dir, 'generate-build-info.mjs');
    copyFileSync(SCRIPT, scriptCopy);
    const out = join(dir, 'out.json');

    let code;
    let stderrText = '';
    try {
      execFileSync(process.execPath, [scriptCopy, '--output', out], {
        cwd: dir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      code = 0;
    } catch (err) {
      code = err.status ?? 1;
      stderrText = err.stderr ? err.stderr.toString() : '';
    }

    assert.equal(code, 0, `script must exit 0 even without git (stderr: ${stderrText})`);
    const data = JSON.parse(readFileSync(out, 'utf-8'));
    assert.equal(data.git, null, 'git block must be null when git unavailable');
    assert.match(
      data.buildTime,
      ISO8601,
      'buildTime must still be a valid ISO8601 timestamp',
    );
    assert.ok(
      typeof data.note === 'string' && data.note.length > 0,
      'note must be a non-empty string explaining the fallback',
    );
    assert.match(
      data.note,
      /git unavailable/i,
      `note should mention git unavailability, got: ${data.note}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing --output exits 2 with usage message', () => {
  let code = 0;
  let stderrText = '';
  try {
    execFileSync(process.execPath, [SCRIPT], {
      cwd: __dirname,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    code = err.status ?? 1;
    stderrText = err.stderr ? err.stderr.toString() : '';
  }
  assert.equal(code, 2, 'missing --output must exit 2');
  assert.match(stderrText, /--output/i, 'stderr must mention --output');
});

test('programmatic import: generateBuildInfo returns the written object', async () => {
  const { generateBuildInfo } = await import('./generate-build-info.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'buildinfo-import-'));
  try {
    const out = join(dir, 'sub', 'nested.json');
    const info = generateBuildInfo(out);
    assert.match(info.buildTime, ISO8601);
    // Creates parent dirs as needed.
    const data = JSON.parse(readFileSync(out, 'utf-8'));
    assert.deepEqual(data, info);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
