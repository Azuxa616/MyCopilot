import { parseAttachment } from './parser.js';
import type { AttachmentParseResult } from './parser.js';

export interface ParseAllResult {
  results: AttachmentParseResult[];
  warnings: string[];
}

/**
 * Parse multiple attachments in sequence.
 *
 * Failures do NOT block — they are collected into the `warnings` array.
 */
export async function parseAllAttachments(
  files: Array<{ name: string; type: string; data: Buffer }>,
): Promise<ParseAllResult> {
  const results: AttachmentParseResult[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    const result = await parseAttachment(file);
    results.push(result);
    if (!result.success) {
      warnings.push(`Failed to parse ${file.name}: ${result.error}`);
    }
  }

  return { results, warnings };
}
