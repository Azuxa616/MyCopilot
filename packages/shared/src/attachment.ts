/** 资产种类，对齐 context-management-v2 RFC 的 AttachmentKind（audio 预留）。 */
export type AssetKind = 'text' | 'markdown' | 'csv' | 'docx' | 'pdf' | 'image' | 'code';

export type AssetSource = 'upload' | 'agent' | 'plugin';

/** 持久化附件资产（原始字节在 DATA_DIR/attachments/<id>，元数据在 assets 表）。 */
export interface Asset {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AssetKind;
  sha256: string;
  source: AssetSource;
  createdAt: number;
  updatedAt: number;
}

export type ImageDetail = 'low' | 'high' | 'original' | 'auto';

/**
 * 多模态消息内容块。content 永远维护为 parts 的纯文本投影
 * （图片替换为 `[图片: name]` 占位；投影函数在 server 侧 attachment/projection.ts）。
 */
export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; assetId: string; detail?: ImageDetail };

/** Wire 层已解析图片（data URL），由 assembler 产出、adapter 消费。 */
export interface WireImagePart {
  url: string;
  detail?: ImageDetail;
}
