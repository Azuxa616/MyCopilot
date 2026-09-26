/**
 * /api/plugins 插件管理路由（插件系统 T9）。
 *
 * 任务分解清单所列端点：GET /、GET /:id、GET /:id/events、POST /install、
 * PATCH /:id/enable、PATCH /:id/disable、DELETE /:id。
 *
 * 能力装配契约（见 plugin/capabilities-combined.ts 头注释）：本模块是
 * combinedCapabilities 的唯一装配点——模块加载即 setCapabilities，
 * loader 默认的 noop 桥从此替换为 mcp+skills 真实桥接。宿主实际生效的
 * 装配依赖 index.ts 挂载本模块（import 即触发）。
 */
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  setCapabilities,
  getPluginsDir,
  installFromDirectory,
  enablePlugin,
  disablePlugin,
  uninstallPlugin,
} from '../plugin/loader.js';
import { extractPluginZip } from '../plugin/upload.js';
import { combinedCapabilities } from '../plugin/capabilities-combined.js';
import { assertNoNamespaceConflict } from '../plugin/namespace.js';
import { listPlugins, getPlugin } from '../repo/plugin.js';
import { listEventsByPlugin } from '../repo/plugin-lifecycle.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { HttpError } from '../middleware/error.js';

// 唯一装配点：模块加载即装配（loader 的 noop 桥 → mcp+skills 聚合桥）。
setCapabilities(combinedCapabilities);

export const pluginsApp = new Hono();

/**
 * loader/能力桥抛出的错误 message 含稳定错误码（PluginLifecycleError 前缀
 * `${code}: `，T7 命名空间断言为 `[code] `，均可用 includes 匹配）。
 * 本表按错误码 → HTTP 状态映射：
 *
 * | message 内错误码 | HTTP | 语义 |
 * | --- | --- | --- |
 * | plugins_dir_not_configured | 500 | 服务端未配置 PLUGINS_DIR（环境问题而非客户端输入） |
 * | manifest_not_found | 404 | 插件目录不存在或清单不可读（ENOENT 类） |
 * | manifest_invalid | 400 | 清单非法 JSON / schema 校验失败（install 附 errors 数组） |
 * | engine_incompatible | 400 | 宿主版本低于清单 minVersion |
 * | mcp_transport_unsupported | 400 | 清单声明的 MCP transport 不可用 |
 * | skill_not_found | 400 | 清单声明的 Skill 文件缺失 |
  * | plugin_not_found | 404 | 插件不存在（enable/disable/uninstall/frontend） |
  * | plugin_already_installed | 409 | 上传安装时同 id 插件已存在（升级流程另议） |
  * | zip_invalid | 400 | 上传 ZIP 解压失败 / 条目路径非法 / 条目超限 |
  * | upload_too_large | 400 | 上传解压后总量超 PLUGIN_UPLOAD_MAX_MB |
  * | plugin_not_enabled | 409 | 拉取插件渲染器时插件未启用 |
  * | frontend_entry_* | 404/400 | 渲染器未声明 / 文件缺失 / 超 1MB |
  * | namespace_conflict | 409 | 与其他已启用插件命名空间冲突（T7 断言 / 清单内部重复） |
  * | official_uninstall_forbidden | 403 | 官方插件禁止卸载 |
  * | invalid_transition | 409 | 七态状态机非法源状态 |
  * | 其他 | 原样抛出 | errorMiddleware 兜底 500（如重复 install 的主键冲突） |
 */
const CODE_TO_STATUS: ReadonlyArray<readonly [string, number]> = [
  ['plugins_dir_not_configured', 500],
  ['manifest_not_found', 404],
  ['manifest_invalid', 400],
  ['engine_incompatible', 400],
  ['mcp_transport_unsupported', 400],
  ['skill_not_found', 400],
  ['plugin_not_found', 404],
  ['plugin_already_installed', 409],
  ['zip_invalid', 400],
  ['upload_too_large', 400],
  ['plugin_not_enabled', 409],
  ['frontend_entry_not_declared', 404],
  ['frontend_entry_missing', 404],
  ['frontend_entry_too_large', 400],
  ['namespace_conflict', 409],
  ['official_uninstall_forbidden', 403],
  ['invalid_transition', 409],
];

/** 按上表把 loader 错误转成 HttpError 抛出；未匹配的错误原样重抛。 */
function throwMapped(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  for (const [code, status] of CODE_TO_STATUS) {
    if (message.includes(code)) {
      throw new HttpError(status, message);
    }
  }
  throw err;
}

/**
 * 从 loader 的 manifest_invalid 消息中拆出校验错误数组——
 * schema 校验失败消息是 `插件清单校验失败：${errors.join('；')}`（validate.ts
 * toMessages 产出的单条消息内不含全角分号），对其做 join 的逆操作；
 * 非法 JSON 等其他变体整条消息作为单元素数组返回。
 */
function extractManifestErrors(message: string): string[] {
  const marker = '插件清单校验失败：';
  const idx = message.indexOf(marker);
  if (idx < 0) return [message];
  return message
    .slice(idx + marker.length)
    .split('；')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

pluginsApp.get('/', (c) => {
  return successResponse(c, listPlugins());
});

pluginsApp.get('/:id', (c) => {
  const id = c.req.param('id');
  const plugin = getPlugin(id);
  if (!plugin) {
    throw new HttpError(404, `插件不存在：${id}`);
  }
  return successResponse(c, plugin);
});

pluginsApp.get('/:id/events', (c) => {
  const id = c.req.param('id');
  if (!getPlugin(id)) {
    throw new HttpError(404, `插件不存在：${id}`);
  }
  // repo 已按 created_at 倒序（最新在前）
  return successResponse(c, listEventsByPlugin(id));
});

pluginsApp.post('/install', async (c) => {
  const body = await c.req.json();
  if (typeof body?.directory !== 'string' || body.directory.trim().length === 0) {
    throw new HttpError(400, 'Missing required field: directory');
  }

  try {
    const record = installFromDirectory(body.directory);
    return successResponse(c, record);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('manifest_invalid')) {
      // 校验失败单独处理：HttpError.details 会被 errorMiddleware 丢弃，
      // 故直接以 errorResponse 附 errors 数组返回。
      return errorResponse(c, 400, message, { errors: extractManifestErrors(message) });
    }
    throwMapped(err);
  }
});

/**
 * 页面上传安装（插件外部化 §3）：multipart ZIP → 内存解压校验 →
 * 落盘到 PLUGINS_DIR/<manifest.name>/ → 复用 installFromDirectory 事务。
 */
pluginsApp.post('/upload', async (c) => {
  const pluginsDir = getPluginsDir();
  if (!pluginsDir) {
    throw new HttpError(500, 'plugins_dir_not_configured: 未配置 PLUGINS_DIR 环境变量，无法安装插件');
  }

  const body = await c.req.parseBody();
  const file = body['file'];
  if (!(file instanceof File)) {
    throw new HttpError(400, 'Missing required field: file (multipart ZIP)');
  }

  const result = extractPluginZip(new Uint8Array(await file.arrayBuffer()));
  if (!result.ok || !result.plugin) {
    const message = result.error ?? 'zip_invalid: ZIP 解析失败';
    if (message.includes('manifest_invalid')) {
      return errorResponse(c, 400, message, { errors: result.errors ?? extractManifestErrors(message) });
    }
    throwMapped(new Error(message));
  }

  const { manifest, files } = result.plugin!;
  if (getPlugin(manifest.name)) {
    throw new HttpError(
      409,
      `plugin_already_installed: 插件「${manifest.name}」已安装（升级流程暂未提供，请先清理后重装）`,
    );
  }

  // 落盘（目录名强制取自 manifest.name，杜绝任意路径写入）
  const targetDir = join(pluginsDir, manifest.name);
  mkdirSync(targetDir, { recursive: true });
  for (const [path, data] of files) {
    const target = join(targetDir, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, data);
  }

  try {
    const record = installFromDirectory(manifest.name);
    return successResponse(c, record, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('manifest_invalid')) {
      return errorResponse(c, 400, message, { errors: extractManifestErrors(message) });
    }
    throwMapped(err);
  }
});

/**
 * 插件卡片渲染器入口（插件外部化 §2）：返回声明的 frontend/index.html 内容，
 * 供前端 PluginCardHost 以 srcdoc 注入沙箱 iframe。要求插件已启用。
 */
pluginsApp.get('/:id/frontend', (c) => {
  const id = c.req.param('id');
  const record = getPlugin(id);
  if (!record) {
    throw new HttpError(404, `plugin_not_found: 插件不存在：${id}`);
  }
  if (record.state !== 'enabled') {
    throw new HttpError(409, `plugin_not_enabled: 插件「${id}」未启用，渲染器不可用`);
  }
  const entry = record.manifest.provides.frontendEntry;
  if (!entry) {
    throw new HttpError(404, `frontend_entry_not_declared: 插件「${id}」未声明 provides.frontendEntry`);
  }

  const pluginsDir = getPluginsDir();
  if (!pluginsDir) {
    throw new HttpError(500, 'plugins_dir_not_configured: 未配置 PLUGINS_DIR 环境变量');
  }

  let html: Buffer;
  try {
    html = readFileSync(join(pluginsDir, record.directory, entry.entry));
  } catch {
    throw new HttpError(404, `frontend_entry_missing: 渲染器文件缺失：${entry.entry}`);
  }
  if (html.byteLength > 1024 * 1024) {
    throw new HttpError(400, 'frontend_entry_too_large: 渲染器入口超过 1 MB 上限');
  }

  return successResponse(c, html.toString('utf-8'));
});

pluginsApp.patch('/:id/enable', (c) => {
  const id = c.req.param('id');
  if (!getPlugin(id)) {
    throw new HttpError(404, `插件不存在：${id}`);
  }
  try {
    // 顺序契约：先做跨插件命名空间冲突断言（T7），再驱动状态机
    assertNoNamespaceConflict(id);
    return successResponse(c, enablePlugin(id));
  } catch (err) {
    throwMapped(err);
  }
});

pluginsApp.patch('/:id/disable', (c) => {
  try {
    return successResponse(c, disablePlugin(c.req.param('id')));
  } catch (err) {
    throwMapped(err);
  }
});

pluginsApp.delete('/:id', (c) => {
  try {
    uninstallPlugin(c.req.param('id'));
    // 照 mcps.ts 的 delete 模式：200 + { deleted }（uninstall 行保留、
    // state='uninstalled'，可经 GET /:id 复查终态）
    return successResponse(c, { deleted: true });
  } catch (err) {
    throwMapped(err);
  }
});
