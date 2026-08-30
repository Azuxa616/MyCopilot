import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { contentTypeFor, createStaticFileHandler } from '../static.js';

describe('静态资源托管（单容器模式）', () => {
  let distDir: string;

  beforeEach(() => {
    distDir = mkdtempSync(join(tmpdir(), 'static-test-'));
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><html><body>root</body></html>');
    mkdirSync(join(distDir, 'assets'), { recursive: true });
    writeFileSync(join(distDir, 'assets', 'index-abc123.js'), 'console.log("app");');
    writeFileSync(join(distDir, 'assets', 'index-def456.css'), 'body { margin: 0; }');
    writeFileSync(join(distDir, 'vite.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    writeFileSync(join(distDir, 'manifest.webmanifest'), '{}');
  });

  afterEach(() => {
    rmSync(distDir, { recursive: true, force: true });
  });

  /** 与 index.ts 相同的挂载方式：catch-all 挂在最后。 */
  function mountApp(): Hono {
    const app = new Hono();
    app.get('*', createStaticFileHandler(distDir));
    return app;
  }

  it('根路径 / 返回 index.html 且 Content-Type 为 text/html', async () => {
    const res = await mountApp().request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=UTF-8');
    expect(await res.text()).toContain('root');
  });

  it('JS 资产返回 text/javascript（浏览器 module script 严格 MIME 检查依赖此项）', async () => {
    const res = await mountApp().request('/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=UTF-8');
    expect(await res.text()).toContain('console.log');
  });

  it('CSS 资产返回 text/css', async () => {
    const res = await mountApp().request('/assets/index-def456.css');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/css; charset=UTF-8');
  });

  it('SVG 资产返回 image/svg+xml', async () => {
    const res = await mountApp().request('/vite.svg');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
  });

  it('SPA 客户端路由（如 /capabilities）未命中文件时回退 index.html 且为 text/html', async () => {
    const res = await mountApp().request('/capabilities');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=UTF-8');
    expect(await res.text()).toContain('root');
  });

  it('未知扩展名回退 application/octet-stream，已知扩展名大小写不敏感', async () => {
    expect(contentTypeFor('/assets/binary.dat')).toBe('application/octet-stream');
    expect(contentTypeFor('/assets/无扩展名')).toBe('application/octet-stream');
    expect(contentTypeFor('/assets/app.JS')).toBe('text/javascript; charset=UTF-8');
    expect(contentTypeFor('/a/b/c/style.CSS')).toBe('text/css; charset=UTF-8');
    expect(contentTypeFor('/index.HTML')).toBe('text/html; charset=UTF-8');
  });
});
