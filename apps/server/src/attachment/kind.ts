import type { AssetKind } from '@my-copilot/shared';
import { extname } from 'node:path';

/** 按魔数判定图片类型（内容优先于文件名/声明 mime——对齐 DeepSeek 行为说明）。 */
export function detectImageMime(buf: Buffer): string | undefined {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return 'image/png';
  if (buf.length >= 4 && buf.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  return undefined;
}

const EXT_KIND: Record<string, AssetKind> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'text',
  '.csv': 'csv',
  '.docx': 'docx',
  '.pdf': 'pdf',
  '.json': 'code',
  '.ts': 'code',
  '.tsx': 'code',
  '.js': 'code',
  '.mjs': 'code',
  '.py': 'code',
  '.rs': 'code',
  '.go': 'code',
};

/** 内容魔数优先（图片 / PDF 头 / DOCX zip 头），声明 mime 与扩展名兜底。 */
export function detectKind(name: string, declaredMime: string, data: Buffer): AssetKind {
  const img = detectImageMime(data);
  if (img) return 'image';
  if (data.subarray(0, 5).toString('ascii') === '%PDF-') return 'pdf';
  if (data.subarray(0, 2).toString('ascii') === 'PK' && extname(name).toLowerCase() === '.docx')
    return 'docx';
  if (declaredMime.startsWith('text/') || declaredMime === 'application/json') {
    const byExt = EXT_KIND[extname(name).toLowerCase()];
    if (byExt) return byExt;
    return declaredMime === 'application/json' ? 'code' : 'text';
  }
  return EXT_KIND[extname(name).toLowerCase()] ?? 'text';
}
