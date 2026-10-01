import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * 资产字节存储：DATA_DIR/attachments/<assetId>（无扩展名，mime 在 assets 表）。
 * DATA_DIR 解析对齐 db/index.ts 的约定（空白视为未配置，默认 ./data）。
 */
export function attachmentsDir(): string {
  const dataDir = process.env.DATA_DIR?.trim() || './data';
  return resolve(dataDir, 'attachments');
}

export async function writeAssetFile(id: string, data: Buffer): Promise<void> {
  const dir = attachmentsDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, id), data);
}

export async function readAssetFile(id: string): Promise<Buffer> {
  return readFile(join(attachmentsDir(), id));
}
