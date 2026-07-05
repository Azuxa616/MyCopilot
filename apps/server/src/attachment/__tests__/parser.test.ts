import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseAttachment } from '../parser.js';
import type { AttachmentParseResult } from '../parser.js';
import { parseAllAttachments } from '../index.js';

// ---------------------------------------------------------------------------
// Mock mammoth
// ---------------------------------------------------------------------------
vi.mock('mammoth', () => ({
  extractRawText: vi.fn(),
}));

import { extractRawText } from 'mammoth';

const mockedExtractRawText = extractRawText as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeFile(name: string, type: string, content: string): { name: string; type: string; data: Buffer } {
  return { name, type, data: Buffer.from(content, 'utf-8') };
}

function longText(length: number): string {
  return 'A'.repeat(length);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('parseAttachment', () => {
  // 1. txt file normal parse
  it('parses a .txt file as plain text', async () => {
    const file = makeFile('notes.txt', 'text/plain', 'Hello World');
    const result = await parseAttachment(file);

    expect(result.success).toBe(true);
    expect(result.text).toBe('Hello World');
    expect(result.meta).toMatchObject({
      name: 'notes.txt',
      type: 'text/plain',
      size: 11,
      textExcerpt: 'Hello World',
    });
  });

  // 2. csv as plain text (no structured parsing)
  it('parses a .csv file as plain text', async () => {
    const csvContent = 'a,b,c\n1,2,3\n';
    const file = makeFile('data.csv', 'text/csv', csvContent);
    const result = await parseAttachment(file);

    expect(result.success).toBe(true);
    expect(result.text).toBe(csvContent);
    expect(result.meta?.name).toBe('data.csv');
    expect(result.meta?.type).toBe('text/csv');
  });

  // 3. docx parse (mock mammoth)
  it('parses a .docx file via mammoth', async () => {
    mockedExtractRawText.mockResolvedValueOnce({ value: 'Document content here' });

    const file = makeFile('report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'binary-garbage');
    const result = await parseAttachment(file);

    expect(result.success).toBe(true);
    expect(result.text).toBe('Document content here');
    expect(result.meta).toMatchObject({
      name: 'report.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      textExcerpt: 'Document content here',
    });
    expect(mockedExtractRawText).toHaveBeenCalledOnce();
  });

  // 4. Corrupted docx → success: false, no throw
  it('returns failure for corrupted docx (no throw)', async () => {
    mockedExtractRawText.mockRejectedValueOnce(new Error('Corrupted ZIP archive'));

    const file = makeFile('broken.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'bad-data');
    const result = await parseAttachment(file);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Corrupted ZIP archive');
    expect(result.meta).toBeUndefined();
    expect(result.text).toBeUndefined();
  });

  // 5. Unsupported type (.xlsx) → success: false
  it('returns failure for unsupported file type', async () => {
    const file = makeFile('sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'binary');
    const result = await parseAttachment(file);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported');
    expect(result.error).toContain('.xlsx');
  });

  // 6. textExcerpt length <= 200
  it('limits textExcerpt to 200 characters', async () => {
    const longContent = longText(500);
    const file = makeFile('long.txt', 'text/plain', longContent);
    const result = await parseAttachment(file);

    expect(result.success).toBe(true);
    expect(result.text).toBe(longContent);
    expect(result.meta!.textExcerpt.length).toBeLessThanOrEqual(200);
    expect(result.meta!.textExcerpt).toBe(longContent.slice(0, 200));
  });
});

// 7. parseAllAttachments mixed success/failure
describe('parseAllAttachments', () => {
  it('parses mixed success and failure files, collecting warnings', async () => {
    mockedExtractRawText.mockResolvedValueOnce({ value: 'Doc content' });

    const files = [
      makeFile('notes.txt', 'text/plain', 'Hello'),
      makeFile('sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'x'),
      makeFile('report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'y'),
    ];

    const { results, warnings } = await parseAllAttachments(files);

    // All 3 results returned (none thrown away)
    expect(results).toHaveLength(3);

    // txt — success
    expect(results[0].success).toBe(true);
    expect(results[0].text).toBe('Hello');

    // xlsx — failure
    expect(results[1].success).toBe(false);
    expect(results[1].error).toContain('Unsupported');

    // docx — success (mocked)
    expect(results[2].success).toBe(true);
    expect(results[2].text).toBe('Doc content');

    // Warnings: only the xlsx failure
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('sheet.xlsx');
    expect(warnings[0]).toContain('Unsupported');
  });
});
