import { describe, it, expect } from 'vitest';
import { detectImageMime, detectKind } from '../kind';
import { projectPartsToText } from '../projection';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const gif = Buffer.from([0x47, 0x49, 0x46, 0x38]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);

describe('detectImageMime', () => {
  it('识别四种图片魔数', () => {
    expect(detectImageMime(jpeg)).toBe('image/jpeg');
    expect(detectImageMime(png)).toBe('image/png');
    expect(detectImageMime(gif)).toBe('image/gif');
    expect(detectImageMime(webp)).toBe('image/webp');
  });
  it('非图片返回 undefined', () => {
    expect(detectImageMime(Buffer.from('hello world'))).toBeUndefined();
  });
  it('过短缓冲安全返回 undefined', () => {
    expect(detectImageMime(Buffer.from([0x89]))).toBeUndefined();
  });
});

describe('detectKind', () => {
  it('内容魔数优先：png 字节 + 任意文件名 → image', () => {
    expect(detectKind('a.dat', 'application/octet-stream', png)).toBe('image');
  });
  it('PDF 头 → pdf', () => {
    expect(detectKind('a.bin', '', Buffer.from('%PDF-1.7'))).toBe('pdf');
  });
  it('DOCX zip 头 + 扩展名 → docx', () => {
    expect(detectKind('a.docx', '', Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe('docx');
  });
  it('文本 mime + 已知扩展名', () => {
    expect(detectKind('a.md', 'text/markdown', Buffer.from('# t'))).toBe('markdown');
    expect(detectKind('a.csv', 'text/csv', Buffer.from('x,y'))).toBe('csv');
  });
  it('文本 mime + 未知扩展名 → text 兜底', () => {
    expect(detectKind('a.log', 'text/plain', Buffer.from('x'))).toBe('text');
  });
  it('json mime + 无扩展名 → code', () => {
    expect(detectKind('data', 'application/json', Buffer.from('{}'))).toBe('code');
  });
});

describe('projectPartsToText', () => {
  const nameOf = (assetId: string) => (assetId === 'a1' ? '图一.png' : assetId);
  it('文本依序拼接，图片占位', () => {
    const parts = [
      { type: 'text' as const, text: '看这张图' },
      { type: 'image' as const, assetId: 'a1' },
    ];
    expect(projectPartsToText(parts, nameOf)).toBe('看这张图\n[图片: 图一.png]');
  });
  it('未知资产名回退为 assetId', () => {
    expect(projectPartsToText([{ type: 'image', assetId: 'zz' }], nameOf)).toBe('[图片: zz]');
  });
  it('空 parts → 空串', () => {
    expect(projectPartsToText([], nameOf)).toBe('');
  });
});
