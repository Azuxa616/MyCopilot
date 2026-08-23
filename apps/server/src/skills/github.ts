import { unzipSync, strFromU8 } from 'fflate';
import type { SkillDetail } from '@my-copilot/shared';
import { parseSkillMarkdown } from './parser.js';
import { createSkill } from '../repo/skill.js';
import {
  SKILL_FILE_MAX_BYTES,
  SKILL_MAX_FILES,
  SKILL_FILES_TOTAL_MAX_BYTES,
  isSkillTextFile,
  isSafeSkillFilePath,
} from './limits.js';

/** 仓库内单个 skill 候选（manifest 条目）。 */
export interface RepoSkillEntry {
  /** 仓库内路径：'' = 根级 SKILL.md；'pdf' = pdf/SKILL.md 目录。 */
  path: string;
  name: string;
  description: string;
  fileCount: number;
}

export interface GithubSkillManifest {
  repo: string; // 'owner/repo'
  ref: string;  // 恒 'HEAD'（默认分支）
  entries: RepoSkillEntry[];
}

const DEFAULT_ALLOWED_HOSTS = 'github.com,codeload.github.com';

function allowedHosts(): string[] {
  return (process.env.SKILL_IMPORT_ALLOWED_HOSTS?.trim() || DEFAULT_ALLOWED_HOSTS)
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function maxArchiveBytes(): number {
  const mb = Number(process.env.SKILL_IMPORT_MAX_MB) || 10;
  return mb * 1024 * 1024;
}

export function parseGithubRepoUrl(url: string): { owner: string; repo: string; archiveUrl: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`无效的仓库 URL：${url}`);
  }
  const host = parsed.hostname.toLowerCase();
  if (!allowedHosts().includes(host)) {
    throw new Error(`仓库域名 ${parsed.hostname} 不允许（SKILL_IMPORT_ALLOWED_HOSTS）`);
  }
  const m = parsed.pathname.match(/^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m) throw new Error(`无法从 URL 解析 owner/repo：${url}`);
  const [, owner, repo] = m;
  // 归档地址从输入 host 推导：github.com 走 codeload；其他白名单 host
  // （自建/Gitee 等）按通用 archive/HEAD.zip 约定。
  const archiveUrl =
    host === 'github.com'
      ? `https://codeload.github.com/${owner}/${repo}/zip/HEAD`
      : `https://${host}/${owner}/${repo}/archive/HEAD.zip`;
  return { owner, repo, archiveUrl };
}

/** 解压后总量上限：压缩上限的 5 倍（防解压炸弹——deflate 压缩比可达 ~1000:1）。 */
function maxDecompressedBytes(): number {
  return maxArchiveBytes() * 5;
}

async function fetchArchive(url: string): Promise<Record<string, Uint8Array>> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`拉取仓库归档失败（HTTP ${res.status}）`);
  }

  const contentLength = res.headers.get('content-length');
  if (contentLength) {
    const len = Number(contentLength);
    if (len > maxArchiveBytes()) {
      const mb = (len / (1024 * 1024)).toFixed(1);
      throw new Error(`仓库归档超过上限（${mb} MB）`);
    }
  }

  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxArchiveBytes()) {
    const mb = (buf.byteLength / (1024 * 1024)).toFixed(1);
    throw new Error(`仓库归档超过上限（${mb} MB）`);
  }

  // 解压炸弹防护：按 zip 头声明的 originalSize 累计拦截，超限即停止解压。
  let rawEntries: Record<string, Uint8Array>;
  let totalOriginal = 0;
  try {
    rawEntries = unzipSync(buf, {
      filter: (file) => {
        totalOriginal += file.originalSize;
        return totalOriginal <= maxDecompressedBytes();
      },
    });
  } catch {
    throw new Error(`无法解析仓库归档：文件损坏或不是有效的 ZIP`);
  }
  if (totalOriginal > maxDecompressedBytes()) {
    throw new Error(
      `仓库归档解压后总量超过上限（${maxDecompressedBytes() / 1024 / 1024} MB），疑似压缩炸弹`,
    );
  }

  const entries: Record<string, Uint8Array> = {};
  for (const [fullPath, content] of Object.entries(rawEntries)) {
    if (fullPath.endsWith('/')) continue;
    const basename = fullPath.split('/').pop()!;
    if (basename.startsWith('.')) continue;
    entries[fullPath] = content;
  }

  return entries;
}

function stripRoot(entries: Record<string, Uint8Array>): Map<string, Uint8Array> {
  const paths = Object.keys(entries);
  if (paths.length === 0) {
    return new Map();
  }

  const root = paths[0].split('/')[0];
  const result = new Map<string, Uint8Array>();

  for (const [fullPath, content] of Object.entries(entries)) {
    const rest = fullPath.substring(root.length + 1);
    if (rest) {
      result.set(rest, content);
    }
  }

  return result;
}

/** 统计 skill 的附属文件数（与 importRepoSkill 收集口径一致：排除 SKILL.md/scripts、按末段扩展名白名单）。 */
function countSkillFiles(entries: Map<string, Uint8Array>, basePath: string): number {
  const prefix = basePath ? `${basePath}/` : '';
  let count = 0;

  for (const [path] of entries.entries()) {
    if (!path.startsWith(prefix)) continue;
    const relPath = path.substring(prefix.length);
    if (relPath === 'SKILL.md') continue;

    const segments = relPath.split('/');
    if (segments.includes('scripts')) continue;

    const basename = segments[segments.length - 1]!;
    if (isSkillTextFile(basename) && isSafeSkillFilePath(relPath)) {
      count++;
    }
  }

  return count;
}

export async function listRepoSkills(url: string): Promise<GithubSkillManifest> {
  const { owner, repo, archiveUrl } = parseGithubRepoUrl(url);
  const rawEntries = await fetchArchive(archiveUrl);
  const entries = stripRoot(rawEntries);

  const manifestEntries: RepoSkillEntry[] = [];

  const dirs = new Set<string>();
  for (const [path] of entries.entries()) {
    const segments = path.split('/');
    if (segments.length >= 2 && segments[1] === 'SKILL.md' && segments.length === 2) {
      dirs.add(segments[0]);
    }
  }

  for (const dir of dirs) {
    const entryPath = `${dir}/SKILL.md`;
    const content = entries.get(entryPath);
    if (content) {
      const body = strFromU8(content);
      const { frontmatter } = parseSkillMarkdown(body);
      if (frontmatter.name) {
        manifestEntries.push({
          path: dir,
          name: frontmatter.name,
          description: frontmatter.description || '',
          fileCount: countSkillFiles(entries, dir),
        });
      }
    }
  }

  const rootSkillPath = 'SKILL.md';
  if (entries.has(rootSkillPath)) {
    const content = entries.get(rootSkillPath)!;
    const body = strFromU8(content);
    const { frontmatter } = parseSkillMarkdown(body);
    if (frontmatter.name) {
      manifestEntries.push({
        path: '',
        name: frontmatter.name,
        description: frontmatter.description || '',
        fileCount: countSkillFiles(entries, ''),
      });
    }
  }

  return {
    repo: `${owner}/${repo}`,
    ref: 'HEAD',
    entries: manifestEntries,
  };
}

export async function importRepoSkill(
  url: string,
  path?: string,
): Promise<SkillDetail> {
  const { archiveUrl } = parseGithubRepoUrl(url);
  const rawEntries = await fetchArchive(archiveUrl);
  const entries = stripRoot(rawEntries);

  const candidates: string[] = [];
  for (const [p] of entries.entries()) {
    const segments = p.split('/');
    if (segments.length === 2 && segments[1] === 'SKILL.md') {
      const content = entries.get(p)!;
      const body = strFromU8(content);
      const { frontmatter } = parseSkillMarkdown(body);
      if (frontmatter.name) {
        candidates.push(segments[0]);
      }
    }
  }

  if (path === undefined) {
    if (candidates.length > 1) {
      throw new Error(`仓库包含多个 skill（${candidates.join('、')}），请指定 path`);
    }
    if (candidates.length === 1) {
      path = candidates[0];
    }
  }

  const prefix = path === undefined || path === '' ? '' : path + '/';
  const entryPath = `${prefix}SKILL.md`;

  if (!entries.has(entryPath)) {
    throw new Error(`仓库中未找到 ${path ?? '(根目录)'} 下的 SKILL.md`);
  }

  const content = entries.get(entryPath)!;
  const body = strFromU8(content);
  const { frontmatter } = parseSkillMarkdown(body);

  if (!frontmatter.name) {
    throw new Error(`仓库中的 SKILL.md 缺少 name 字段`);
  }

  let totalBytes = 0;
  const sideFiles: { path: string; content: Uint8Array }[] = [];

  for (const [fullPath, content] of entries.entries()) {
    if (!fullPath.startsWith(prefix)) continue;

    const relPath = fullPath.substring(prefix.length);

    if (relPath === 'SKILL.md') continue;

    const segments = relPath.split('/');
    if (segments.includes('scripts')) continue;

    const basename = segments[segments.length - 1]!;

    if (!isSkillTextFile(basename)) continue;

    if (!isSafeSkillFilePath(relPath)) continue;

    if (content.byteLength > SKILL_FILE_MAX_BYTES) {
      throw new Error(`文件 ${relPath} 超过单文件大小上限（${SKILL_FILE_MAX_BYTES / 1024} KB）`);
    }

    totalBytes += content.byteLength;

    sideFiles.push({ path: relPath, content });
  }

  if (sideFiles.length > SKILL_MAX_FILES) {
    throw new Error(`skill 文件数量超过上限（${SKILL_MAX_FILES}）`);
  }

  if (totalBytes > SKILL_FILES_TOTAL_MAX_BYTES) {
    throw new Error(`skill 文件总大小超过上限（${SKILL_FILES_TOTAL_MAX_BYTES / 1024 / 1024} MB）`);
  }

  const files = sideFiles.map(({ path, content }) => ({
    path,
    content: strFromU8(content),
  }));

  return createSkill({
    name: frontmatter.name,
    description: frontmatter.description,
    body,
    triggers: frontmatter.triggers,
    // 远端声明的 always 不信任（终审 I1）：仓库导入恒为清单形态，
    // 用户审阅内容后可在管理页手动开启全文注入。
    always: false,
    files: files.length > 0 ? files : undefined,
    source: 'upload',
  });
}