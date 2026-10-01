import { describe, it, expect } from 'vitest';
import type { Asset, AssetKind, MessagePart, WireImagePart } from '../attachment';

describe('attachment shared types', () => {
  it('AssetKind 覆盖设计枚举', () => {
    const kinds: AssetKind[] = ['text', 'markdown', 'csv', 'docx', 'pdf', 'image', 'code'];
    expect(kinds).toHaveLength(7);
  });
  it('MessagePart image 形状（assetId + 可选 detail）', () => {
    const part: MessagePart = { type: 'image', assetId: 'a1', detail: 'low' };
    expect(part.type).toBe('image');
  });
  it('MessagePart text 形状', () => {
    const part: MessagePart = { type: 'text', text: '你好' };
    expect(part.type).toBe('text');
  });
  it('Asset 形状', () => {
    const a: Asset = {
      id: 'a1',
      name: 'x.png',
      mimeType: 'image/png',
      size: 1,
      kind: 'image',
      sha256: 'h',
      source: 'upload',
      createdAt: 1,
      updatedAt: 1,
    };
    expect(a.kind).toBe('image');
  });
  it('WireImagePart 形状', () => {
    const w: WireImagePart = { url: 'data:image/png;base64,AAA', detail: 'auto' };
    expect(w.url.startsWith('data:')).toBe(true);
  });
});
