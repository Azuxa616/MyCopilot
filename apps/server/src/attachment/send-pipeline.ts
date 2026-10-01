/**
 * 发送链路的附件分类管道（docs/2026-09-30-attachment-assets-multimodal-design.md）。
 *
 * 两条入口汇入同一分类结果：
 * - `resolveAssetsFromFiles`：multipart 原始文件 → 资产化（落盘 + 入库）后分类；
 * - `resolveAssetsFromIds`：JSON assetIds 引用已上传资产 → 直接分类。
 * 分类规则：image kind → imageParts（一等消息内容）；文本类 → parseAttachment
 * 提取 AttachmentText（注入管道）。解析失败收集进 warnings，由路由层转 422
 * （保持既有契约）。
 */
import type { AttachmentMeta, MessagePart } from '@my-copilot/shared';
import { createHash } from 'node:crypto';
import type { AttachmentText } from '../prompt/assembler.js';
import { parseAttachment } from './parser.js';
import { detectKind } from './kind.js';
import { createAsset, getAsset } from '../repo/asset.js';
import { writeAssetFile, readAssetFile } from './storage.js';

/** 发送链路的附件分类结果。 */
export interface SendAttachmentOutcome {
  attachmentsMeta: AttachmentMeta[];
  attachmentTexts: AttachmentText[];
  imageParts: MessagePart[];
  /** 解析失败项（路由层转 422）。 */
  warnings: string[];
}

function emptyOutcome(): SendAttachmentOutcome {
  return { attachmentsMeta: [], attachmentTexts: [], imageParts: [], warnings: [] };
}

/** multipart 原始文件 → 资产化并按 kind 分类。 */
export async function resolveAssetsFromFiles(
  files: Array<{ name: string; type: string; data: Buffer }>,
): Promise<SendAttachmentOutcome> {
  const outcome = emptyOutcome();
  for (const file of files) {
    const kind = detectKind(file.name, file.type, file.data);
    const asset = createAsset({
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.data.length,
      kind,
      sha256: createHash('sha256').update(file.data).digest('hex'),
    });
    await writeAssetFile(asset.id, file.data);

    if (kind === 'image') {
      outcome.attachmentsMeta.push({
        assetId: asset.id,
        name: file.name,
        type: asset.mimeType,
        size: asset.size,
      });
      outcome.imageParts.push({ type: 'image', assetId: asset.id });
      continue;
    }

    const parsed = await parseAttachment(file);
    const meta = parsed.meta;
    if (!parsed.success || !meta || parsed.text === undefined) {
      outcome.warnings.push(`${file.name}: ${parsed.error ?? '文本提取失败'}`);
      continue;
    }
    outcome.attachmentsMeta.push({ ...meta, assetId: asset.id });
    outcome.attachmentTexts.push({ name: meta.name, content: parsed.text });
  }
  return outcome;
}

/** JSON assetIds → 已有资产分类（文本类重读字节提取）。 */
export async function resolveAssetsFromIds(assetIds: string[]): Promise<SendAttachmentOutcome> {
  const outcome = emptyOutcome();
  for (const id of assetIds) {
    const asset = getAsset(id);
    if (!asset) {
      outcome.warnings.push(`资产不存在: ${id}`);
      continue;
    }
    if (asset.kind === 'image') {
      outcome.attachmentsMeta.push({
        assetId: asset.id,
        name: asset.name,
        type: asset.mimeType,
        size: asset.size,
      });
      outcome.imageParts.push({ type: 'image', assetId: asset.id });
      continue;
    }

    let data: Buffer;
    try {
      data = await readAssetFile(asset.id);
    } catch {
      outcome.warnings.push(`${asset.name}: 资产文件缺失`);
      continue;
    }
    const parsed = await parseAttachment({ name: asset.name, type: asset.mimeType, data });
    const meta = parsed.meta;
    if (!parsed.success || !meta || parsed.text === undefined) {
      outcome.warnings.push(`${asset.name}: ${parsed.error ?? '文本提取失败'}`);
      continue;
    }
    outcome.attachmentsMeta.push({ ...meta, assetId: asset.id });
    outcome.attachmentTexts.push({ name: meta.name, content: parsed.text });
  }
  return outcome;
}
