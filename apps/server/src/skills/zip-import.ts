import { unzipSync, strFromU8 } from 'fflate';
import { parseSkillMarkdown } from './parser.js';
import {
  SKILL_FILE_MAX_BYTES,
  SKILL_MAX_FILES,
  SKILL_FILES_TOTAL_MAX_BYTES,
  isSkillTextFile,
  isSafeSkillFilePath,
} from './limits.js';

/** parseSkillZip 的成功载荷（对齐 CreateSkillParams 的可编辑副本语义）。 */
export interface ImportedSkill {
  name: string;
  description: string;
  body: string;
  triggers?: string[];
  files: Array<{ path: string; content: string }>;
}

/** fail-soft 结果结构（对齐 attachment/parser.ts 风格：永不 throw）。 */
export interface SkillZipResult {
  ok: boolean;
  error?: string;
  skill?: ImportedSkill;
}

/**
 * 解析 ZIP 形式的 skill 目录包（对齐 Claude Code 生态格式）。
 *
 * 识别三种形态：
 * 1. 根级 `SKILL.md`（+ 附属文件）
 * 2. 唯一子目录下的 `<name>/SKILL.md`
 * 3. 根级单个 `*.md`（旧平铺形态）
 *
 * 附属文件：跳过 `scripts/` 前缀与非白名单扩展名；超限/超数直接失败并指明路径
 * （导入路径按设计文档报 400，目录同步才是"跳过 + 计数"语义）。
 */
export function parseSkillZip(buffer: Uint8Array): SkillZipResult {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(buffer);
  } catch {
    return { ok: false, error: '无法解析 ZIP 文件：文件损坏或不是有效的 ZIP 格式' };
  }

  // 过滤目录条目（zip 中目录以 / 结尾）与隐藏文件
  const fileEntries = Object.entries(entries).filter(
    ([path]) =>
      !path.endsWith('/') && !path.split('/').pop()!.startsWith('.'),
  );
  const paths = fileEntries.map(([p]) => p);

  // 定位 SKILL.md：根级 > 唯一子目录级
  const rootSkill = paths.find((p) => p === 'SKILL.md');
  const nestedSkill = rootSkill ? undefined : paths.find((p) => /^[^/]+\/SKILL\.md$/.test(p));

  let entryPath: string | undefined;
  if (rootSkill) {
    entryPath = rootSkill;
  } else if (nestedSkill) {
    entryPath = nestedSkill;
  } else {
    // 兼容：根级单个 .md（旧平铺形态）
    const flatMds = paths.filter((p) => p.toLowerCase().endsWith('.md') && !p.includes('/'));
    if (flatMds.length === 1) {
      entryPath = flatMds[0];
    } else {
      return {
        ok: false,
        error: 'ZIP 中未找到 SKILL.md（支持根级或唯一子目录下的 SKILL.md）',
      };
    }
  }

  const raw = strFromU8(entries[entryPath]);
  const parsed = parseSkillMarkdown(raw);
  if (!parsed.frontmatter.name) {
    return { ok: false, error: 'SKILL.md 的 frontmatter 缺少 name 字段' };
  }

  // 嵌套形态（<name>/SKILL.md）下附属文件剥离 pack 根前缀，与 scanner 的
  // "相对 pack 根"语义对齐；pack 子目录之外的条目不属于该 pack，跳过。
  const packPrefix = nestedSkill ? nestedSkill.slice(0, nestedSkill.indexOf('/') + 1) : '';

  // 收集附属文件（跳过入口自身与 scripts/）
  const files: Array<{ path: string; content: string }> = [];
  let totalBytes = 0;
  const oversize: string[] = [];
  const unsafe: string[] = [];

  for (const [path, data] of fileEntries) {
    if (path === entryPath) continue;
    if (path === 'scripts' || path.startsWith('scripts/')) continue;
    if (packPrefix && !path.startsWith(packPrefix)) continue;
    const relPath = packPrefix ? path.slice(packPrefix.length) : path;
    const baseName = relPath.split('/').pop()!;
    if (!isSkillTextFile(baseName)) continue;
    if (!isSafeSkillFilePath(relPath)) {
      unsafe.push(path);
      continue;
    }

    if (data.length > SKILL_FILE_MAX_BYTES) {
      oversize.push(relPath);
      continue;
    }
    if (files.length >= SKILL_MAX_FILES) {
      return { ok: false, error: `附属文件数量超过上限（${SKILL_MAX_FILES} 个）` };
    }
    if (totalBytes + data.length > SKILL_FILES_TOTAL_MAX_BYTES) {
      return { ok: false, error: `附属文件总大小超过上限（${SKILL_FILES_TOTAL_MAX_BYTES} 字节）` };
    }

    files.push({ path: relPath, content: strFromU8(data) });
    totalBytes += data.length;
  }

  if (unsafe.length > 0) {
    return {
      ok: false,
      error: `以下 ZIP 条目路径不安全（不允许 ..、绝对路径或反斜杠）：${unsafe.join(', ')}`,
    };
  }
  if (oversize.length > 0) {
    return {
      ok: false,
      error: `以下附属文件超过单文件上限（${SKILL_FILE_MAX_BYTES} 字节）：${oversize.join(', ')}`,
    };
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    ok: true,
    skill: {
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      body: parsed.body,
      triggers: parsed.frontmatter.triggers,
      files,
    },
  };
}