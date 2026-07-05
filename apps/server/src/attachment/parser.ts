import type { AttachmentMeta } from '@my-copilot/shared';
import { extname } from 'node:path';
import { extractRawText } from 'mammoth';

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
 */
export async function parseAttachment(
  file: { name: string; type: string; data: Buffer },
): Promise<AttachmentParseResult> {
  const ext = extname(file.name).toLowerCase();

  try {
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
      const result = await extractRawText({ arrayBuffer: file.data.buffer });
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
