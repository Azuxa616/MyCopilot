import { readFile } from 'node:fs/promises';
import type { Context } from 'hono';

/**
 * 静态资源 Content-Type 映射（按扩展名，全小写）。
 *
 * 背景：单容器模式（SERVER_PUBLIC_DIR）下由 Server 直接托管 Web 构建产物。
 * 历史上 `c.body(file)` 未设置 Content-Type，Hono 会默认 `text/plain`，
 * 导致真实浏览器依严格 MIME 检查拒绝执行全部 module script，SPA 完全无法挂载。
 */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'text/javascript; charset=UTF-8',
  '.mjs': 'text/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.map': 'application/json; charset=UTF-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=UTF-8',
};

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/** 按路径扩展名推断 Content-Type；未知扩展名回退 `application/octet-stream`。 */
export function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.');
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : '';
  return CONTENT_TYPES[ext] ?? DEFAULT_CONTENT_TYPE;
}

/**
 * 构建静态资源 catch-all 处理器（挂载在所有 API 路由之后）。
 *
 * 行为与原内联实现一致，仅补上 Content-Type：
 * - `/` 映射到 `index.html`
 * - 文件命中 → 200 + 按扩展名的 Content-Type
 * - 文件未命中（SPA 客户端路由如 `/capabilities`）→ 回退 `index.html`（text/html）
 */
export function createStaticFileHandler(publicDir: string): (c: Context) => Promise<Response> {
  return async (c) => {
    const filePath = `${publicDir}${c.req.path === '/' ? '/index.html' : c.req.path}`;
    try {
      const file = await readFile(filePath);
      return c.body(file, 200, { 'Content-Type': contentTypeFor(filePath) });
    } catch {
      return c.html((await readFile(`${publicDir}/index.html`)).toString('utf-8'));
    }
  };
}
