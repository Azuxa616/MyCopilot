/**
 * 插件 ZIP 上传解析（插件外部化：页面上传安装）。
 *
 * fail-soft 结构（照 attachment/parser.ts 与 skills/zip-import.ts 惯例：永不 throw）：
 * 内存中解压（fflate）→ zip-slip 防护 → 大小/条目数限额 → 结构归一化 →
 * plugin.json 解析 + manifest 校验。落盘与安装事务由路由层驱动。
 *
 * 约定（见 spec 2026-09-26-plugin-externalization-design.md §3）：
 * - 接受「单一根目录/plugin.json」或「根直接含 plugin.json」两种 ZIP 形态；
 * - 落盘目标目录名强制取自 manifest.name（调用方拼接 PLUGINS_DIR），与 ZIP 根目录名无关；
 * - 条目路径拒绝 `..`、绝对路径、反斜杠；条目数 ≤ 500；解压总字节 ≤ 限额。
 */
import { unzipSync } from 'fflate';
import type { PluginManifest } from '@my-copilot/shared';
import { validateManifest } from './validate.js';

/** 条目数硬上限（防御压缩炸弹的展开形态之一）。 */
const MAX_ENTRIES = 500;

/** 单条目大小上限（字节）：16 MiB——单文件超过即拒。 */
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;

/** 解压成功载荷：归一化后的相对路径（POSIX 风格，无根目录前缀）→ 文件内容。 */
export interface ExtractedPlugin {
  manifest: PluginManifest;
  /** 校验错误消息（manifest_invalid 时给路由拼 errors 用）。 */
  files: Map<string, Buffer>;
}

export interface PluginZipResult {
  ok: boolean;
  error?: string;
  /** manifest 校验失败时的中文错误列表（error 含 manifest_invalid 时存在）。 */
  errors?: string[];
  plugin?: ExtractedPlugin;
}

/** 读取 PLUGIN_UPLOAD_MAX_MB（默认 20）。 */
export function pluginUploadMaxBytes(): number {
  const mb = Number(process.env.PLUGIN_UPLOAD_MAX_MB) || 20;
  return mb * 1024 * 1024;
}

/**
 * 解压并校验插件 ZIP。目录条目（以 / 结尾）被跳过，仅收集文件。
 * 归一化：若存在单一顶层目录且 plugin.json 不在根上，则剥去该前缀。
 */
export function extractPluginZip(buffer: Uint8Array): PluginZipResult {
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(buffer);
  } catch {
    return { ok: false, error: 'zip_invalid: ZIP 解压失败（文件损坏或非 ZIP 格式）' };
  }

  if (Object.keys(unzipped).length > MAX_ENTRIES) {
    return { ok: false, error: `zip_invalid: 条目数超过上限 ${MAX_ENTRIES}` };
  }

  const totalBytes = Object.values(unzipped).reduce((sum, data) => sum + data.byteLength, 0);
  const maxBytes = pluginUploadMaxBytes();
  if (totalBytes > maxBytes) {
    return {
      ok: false,
      error: `upload_too_large: 解压后总大小超过 ${Math.floor(maxBytes / 1024 / 1024)} MB 上限`,
    };
  }

  // 收集文件条目并做 zip-slip 防护
  const entries = new Map<string, Buffer>();
  for (const [rawPath, data] of Object.entries(unzipped)) {
    if (rawPath.endsWith('/')) continue; // 目录条目
    if (data.byteLength > MAX_ENTRY_BYTES) {
      return { ok: false, error: 'zip_invalid: 单个文件超过 16 MB 上限' };
    }
    const posix = rawPath.replace(/\\/g, '/');
    if (posix.startsWith('/') || posix.includes('..') || /^[a-zA-Z]:/.test(posix)) {
      return { ok: false, error: `zip_invalid: 条目路径非法（${rawPath}）` };
    }
    entries.set(posix, Buffer.from(data));
  }

  if (entries.size === 0) {
    return { ok: false, error: 'zip_invalid: ZIP 内没有文件' };
  }

  // 结构归一化：根无 plugin.json 时，剥去单一顶层目录前缀
  let prefix = '';
  if (!entries.has('plugin.json')) {
    const roots = new Set(
      [...entries.keys()].map((p) => (p.includes('/') ? p.slice(0, p.indexOf('/')) : p)),
    );
    if (roots.size !== 1) {
      return { ok: false, error: 'manifest_invalid: ZIP 内未找到 plugin.json（根或单一顶层目录）' };
    }
    prefix = `${[...roots][0]}/`;
    if (!entries.has(`${prefix}plugin.json`)) {
      return { ok: false, error: 'manifest_invalid: ZIP 内未找到 plugin.json' };
    }
  }

  // 解析并校验 manifest
  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(entries.get(`${prefix}plugin.json`)!.toString('utf-8'));
  } catch {
    return { ok: false, error: 'manifest_invalid: plugin.json 不是合法 JSON' };
  }
  const validation = validateManifest(manifestRaw);
  if (!validation.valid) {
    return { ok: false, error: `manifest_invalid: 插件清单校验失败：${validation.errors.join('；')}`, errors: validation.errors };
  }

  // 输出去前缀后的文件集（plugin.json 本身也保留，落盘时原样写出）
  const files = new Map<string, Buffer>();
  for (const [path, data] of entries) {
    if (path.startsWith(prefix)) files.set(path.slice(prefix.length), data);
  }

  return { ok: true, plugin: { manifest: manifestRaw as PluginManifest, files } };
}
