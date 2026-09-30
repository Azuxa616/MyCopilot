import type { AttachmentMeta } from '@my-copilot/shared';
import { extname } from 'node:path';
import { extractRawText } from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { detectImageMime } from './kind.js';

/** Maximum length of textExcerpt stored in attachment meta. */
const MAX_EXCERPT = 200;

/** Extensions treated as plain UTF-8 text (CSV parsed as plain text per spec). */
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.csv']);

export interface AttachmentParseResult {
  success: boolean;
  meta?: AttachmentMeta;
  text?: string;
  error?: string;
}

/**
 * Parse a single attachment into text + metadata.
 *
 * Never throws — always returns an {@link AttachmentParseResult}.
 * 优先级：图片魔数（成功但无 text，meta.type 为探测出的真实 mime）→
 * PDF（扩展名或 %PDF 头，经 pdf-parse v2 提取文本）→ 纯文本扩展名 →
 * docx（mammoth）→ 不支持。
 */
export async function parseAttachment(
  file: { name: string; type: string; data: Buffer },
): Promise<AttachmentParseResult> {
  const ext = extname(file.name).toLowerCase();

  try {
    // --- images: content-first (magic numbers), no text extraction ---
    const imgMime = detectImageMime(file.data);
    if (imgMime) {
      const meta: AttachmentMeta = { name: file.name, type: imgMime, size: file.data.length };
      return { success: true, meta };
    }

    // --- pdf via pdf-parse (v2 class API) ---
    const isPdf = ext === '.pdf' || file.data.subarray(0, 5).toString('ascii') === '%PDF-';
    if (isPdf) {
      const parser = new PDFParse({ data: new Uint8Array(file.data) });
      try {
        const result = await parser.getText();
        const text = result.text;
        const meta: AttachmentMeta = {
          name: file.name,
          type: file.type || 'application/pdf',
          size: file.data.length,
          textExcerpt: text.slice(0, MAX_EXCERPT),
        };
        return { success: true, meta, text };
      } finally {
        await parser.destroy().catch(() => {});
      }
    }

    // --- plain text formats ---
    if (TEXT_EXTENSIONS.has(ext)) {
      const text = file.data.toString('utf-8');
      const meta: AttachmentMeta = {
        name: file.name,
        type: file.type,
        size: file.data.length,
        textExcerpt: text.slice(0, MAX_EXCERPT),
      };
      return { success: true, meta, text };
    }

    // --- docx via mammoth ---
    if (ext === '.docx') {
      const result = await extractRawText({ buffer: file.data });
      const text = result.value;
      const meta: AttachmentMeta = {
        name: file.name,
        type: file.type,
        size: file.data.length,
        textExcerpt: text.slice(0, MAX_EXCERPT),
      };
      return { success: true, meta, text };
    }

    // --- unsupported ---
    return { success: false, error: `Unsupported file type: ${ext || 'unknown'}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
