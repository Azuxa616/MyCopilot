import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseAttachment } from '../parser.js';
import { parseAllAttachments } from '../index.js';

// ---------------------------------------------------------------------------
// Mock mammoth
// ---------------------------------------------------------------------------
vi.mock('mammoth', () => ({
  extractRawText: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock pdf-parse（v2 class API）
// ---------------------------------------------------------------------------
interface PdfParseMockControls {
  getText: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}
vi.mock('pdf-parse', () => {
  const getText = vi.fn(async () => ({ text: 'PDF 全文内容' }));
  const destroy = vi.fn(async () => {});
  class PDFParseMock {
    constructor(public options: unknown) {}
    getText = getText;
    destroy = destroy;
    static __controls: PdfParseMockControls = { getText, destroy };
  }
  return { PDFParse: PDFParseMock };
});

import { extractRawText } from 'mammoth';
import { PDFParse } from 'pdf-parse';

const mockedExtractRawText = extractRawText as ReturnType<typeof vi.fn>;
const pdfControls = (PDFParse as unknown as { __controls: PdfParseMockControls }).__controls;

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
    expect(mockedExtractRawText).toHaveBeenCalledWith({ buffer: file.data });
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
    expect(result.meta!.textExcerpt!.length).toBeLessThanOrEqual(200);
    expect(result.meta!.textExcerpt).toBe(longContent.slice(0, 200));
  });

  // 7. image: magic-number detection wins, no text, real mime in meta
  it('parses a png image via magic numbers (no text)', async () => {
    const file = {
      name: 'photo.dat',
      type: 'application/octet-stream',
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    };
    const result = await parseAttachment(file);

    expect(result.success).toBe(true);
    expect(result.text).toBeUndefined();
    expect(result.meta).toMatchObject({ name: 'photo.dat', type: 'image/png', size: 8 });
  });

  it('parses a jpeg image', async () => {
    const file = {
      name: 'pic.jpg',
      type: 'image/jpeg',
      data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    };
    const result = await parseAttachment(file);

    expect(result.success).toBe(true);
    expect(result.meta?.type).toBe('image/jpeg');
  });

  // 8. pdf: extracted via pdf-parse v2, destroy called, excerpt truncated
  it('parses a .pdf file via pdf-parse', async () => {
    const file = { name: 'doc.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.7 fake') };
    const result = await parseAttachment(file);

    expect(result.success).toBe(true);
    expect(result.text).toBe('PDF 全文内容');
    expect(result.meta).toMatchObject({
      name: 'doc.pdf',
      type: 'application/pdf',
      textExcerpt: 'PDF 全文内容',
    });
    expect(pdfControls.destroy).toHaveBeenCalled();
  });

  it('pdf parse failure is fail-soft (no throw)', async () => {
    pdfControls.getText.mockRejectedValueOnce(new Error('bad xref'));
    const file = { name: 'broken.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.7') };
    const result = await parseAttachment(file);

    expect(result.success).toBe(false);
    expect(result.error).toContain('bad xref');
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
