import type { MessagePart } from '@my-copilot/shared';

/**
 * parts → 纯文本投影。content 恒由本函数从 parts 派生：
 * 文本 part 依序拼接，图片 part 替换为 `[图片: name]` 占位（name 由调用方
 * 经 nameOf 从资产表解析）。位于 server 侧因 shared 包为 types-only。
 */
export function projectPartsToText(
  parts: MessagePart[],
  nameOf: (assetId: string) => string,
): string {
  return parts
    .map((p) => (p.type === 'text' ? p.text : `[图片: ${nameOf(p.assetId)}]`))
    .join('\n');
}
