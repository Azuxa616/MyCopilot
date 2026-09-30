import type { ImageDetail, MessagePart, WireImagePart } from '@my-copilot/shared';
import { getAsset } from '../repo/asset.js';
import { readAssetFile } from './storage.js';

/**
 * 历史图片保留窗口（设计开放问题 1 的默认值，实施前可调）：
 * age = 1..N 的历史 user 轮图片降 detail='low' 继续发送；age > N 的图片
 * 不再发送字节（仅保留 content 投影中的占位文本）。
 */
export const HISTORY_IMAGE_WINDOW = 5;

/**
 * 纯策略：按 user 轮龄改写图片 parts。
 * age = 0（当前轮）原样；1..N 强制 detail='low'；> N 丢弃（返回中剔除）。
 * 文本 part 恒原样透传。
 */
export function applyImagePolicy(parts: MessagePart[], userTurnAge: number): MessagePart[] {
  return parts.flatMap((p) => {
    if (p.type !== 'image') return [p];
    if (userTurnAge <= 0) return [p];
    if (userTurnAge <= HISTORY_IMAGE_WINDOW) {
      const detail: ImageDetail = 'low';
      return [{ ...p, detail }];
    }
    return [];
  });
}

/** 解析为 wire 图片（读资产字节 → data URL）。资产缺失或非图片时跳过（fail-soft）。 */
export async function resolveWireImages(parts: MessagePart[]): Promise<WireImagePart[]> {
  const out: WireImagePart[] = [];
  for (const p of parts) {
    if (p.type !== 'image') continue;
    try {
      const asset = getAsset(p.assetId);
      if (!asset || asset.kind !== 'image') continue;
      const buf = await readAssetFile(p.assetId);
      out.push({
        url: `data:${asset.mimeType};base64,${buf.toString('base64')}`,
        detail: p.detail,
      });
    } catch {
      // fail-soft：单个资产读取失败跳过，不阻断装配
    }
  }
  return out;
}

/** 本次请求是否携带图片（能力学习闭环的判定输入，供能力探测计划接线）。 */
export function hasImageParts(parts: MessagePart[] | undefined): boolean {
  return !!parts?.some((p) => p.type === 'image');
}
