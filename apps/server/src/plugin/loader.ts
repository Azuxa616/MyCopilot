/**
 * Plugin loader —— 七态生命周期状态机驱动器（插件系统 T4）。
 *
 * 状态机（docs/rfc/plugin-manifest-lifecycle.md）：
 * discovered -> downloaded -> verified -> installed；enabled <-> disabled；uninstalled。
 *
 * - install 链（discovered→installed）由 installFromDirectory 在单个
 *   better-sqlite3 事务内固定顺序驱动，任一步抛错整体回滚（plugins 行、
 *   事件行、capabilities 写入的行全部消失）。
 * - enable/disable/uninstall 是用户入口，按 USER_TRANSITIONS 校验源状态，
 *   表中不存在的 (动作, 当前状态) 组合视为非法转移（模式参考
 *   agent-loop/run-state.ts 的 RUN_TRANSITIONS）。
 * - 能力装配通过 PluginCapabilities 接口注入（默认 noop，T5/T6 装配时
 *   调用 setCapabilities 替换）。
 *
 * 事件 trigger 约定：install 链为 'system'（宿主本地导入驱动）、
 * enable/disable/uninstall 为 'user'。注：任务分解原文写作
 * 'local-import'，但 T1 的 LifecycleTrigger 枚举与 lifecycle-event
 * schema 仅允许 user/system/dependency/rollback，故取语义最近的 'system'。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LifecycleState, LifecycleTrigger, PluginManifest } from '@my-copilot/shared';
import { getDb } from '../db/index.js';
import { createPlugin, getPlugin, updatePluginState, type PluginRecord } from '../repo/plugin.js';
import { recordEvent } from '../repo/plugin-lifecycle.js';
import { deleteMcpsByPlugin } from '../repo/mcp.js';
import { deleteSkillsByPlugin } from '../repo/skill.js';
import { deleteAllData } from '../repo/plugin-data.js';
import { validateManifest } from './validate.js';
import { noopCapabilities, type PluginCapabilities } from './capabilities.js';

/**
 * 宿主引擎版本。事实来源为 apps/server/package.json 的 `version`
 * （当前 0.1.0），本文件以常量镜像以避免运行时读包文件。本轮仅用它检查
 * engineCompatibility.minVersion 下界；maxVersion 上界本轮不检查。
 * RFC §3 示例清单中的 0.4.0 仅是 schema 测试用例，不是宿主版本依据。
 */
export const HOST_VERSION = '0.1.0';

/**
 * 手写数字三元组 semver 比较（不引入 semver 依赖）：split('.') 后逐段
 * Number 比较，缺段按 0 处理。预发布/构建后缀不参与比较（manifest schema
 * 已保证输入为合法 SemVer，此处只需粗粒度的引擎下界判断）。
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * 读取插件根目录 PLUGINS_DIR（照 index.ts 中 SKILLS_DIR 的模式：
 * 空白字符串视为未配置）。未配置时返回 `undefined`。
 */
export function getPluginsDir(): string | undefined {
  return process.env.PLUGINS_DIR?.trim() || undefined;
}

/**
 * 生命周期错误：message 以 `${errorCode}: ` 开头（含稳定错误码，供 T9
 * 路由层映射 HTTP 状态），errorCode 字段供程序化消费。
 */
export class PluginLifecycleError extends Error {
  readonly errorCode: string;

  constructor(errorCode: string, message: string) {
    super(`${errorCode}: ${message}`);
    this.name = 'PluginLifecycleError';
    this.errorCode = errorCode;
  }
}

/**
 * 用户入口（enable/disable/uninstall）的合法源状态表。install 链
 * （discovered→installed）在 installFromDirectory 的单事务内固定顺序
 * 驱动，不经此表；表中不存在的 (动作, 当前状态) 组合视为非法转移。
 */
const USER_TRANSITIONS: Readonly<
  Record<'enable' | 'disable' | 'uninstall', readonly LifecycleState[]>
> = {
  enable: ['installed', 'disabled'],
  disable: ['enabled'],
  // enabled 经 uninstallPlugin 内的隐式 disablePlugin 先转到 disabled。
  uninstall: ['installed', 'disabled', 'enabled'],
};

let capabilities: PluginCapabilities = noopCapabilities;

/**
 * 模块级能力注入点（默认 noop）。T5/T6 实现真实桥接后，在各自任务的
 * 装配处调用以替换。
 */
export function setCapabilities(caps: PluginCapabilities): void {
  capabilities = caps;
}

/** 记录一条成功转换事件（type 与 toState 1:1，version 取清单版本）。 */
function recordSuccess(params: {
  pluginId: string;
  fromState: LifecycleState | null;
  toState: LifecycleState;
  version: string;
  trigger: LifecycleTrigger;
  payload?: Record<string, unknown>;
}): void {
  recordEvent({
    pluginId: params.pluginId,
    fromState: params.fromState,
    toState: params.toState,
    type: params.toState,
    trigger: params.trigger,
    version: params.version,
    result: { status: 'success' },
    payload: params.payload,
  });
}

/** 解析插件安装目录（PLUGINS_DIR 下的子目录）。 */
function resolvePluginDir(pluginsDir: string, directory: string): string {
  return join(pluginsDir, directory);
}

/**
 * provides 内部重复资源检查：mcpServers 内 id 重复 / skills 内 path 重复
 * 视为清单自身命名空间冲突（跨插件冲突检测是 T7 的 assertNoNamespace-
 * Conflict，挂在 T9 路由层，不在本任务）。
 */
function assertNoInternalConflicts(manifest: PluginManifest): void {
  const mcpIds = new Set<string>();
  for (const server of manifest.provides.mcpServers ?? []) {
    if (mcpIds.has(server.id)) {
      throw new PluginLifecycleError(
        'namespace_conflict',
        `清单 provides.mcpServers 内 id "${server.id}" 重复`,
      );
    }
    mcpIds.add(server.id);
  }
  const skillPaths = new Set<string>();
  for (const skill of manifest.provides.skills ?? []) {
    if (skillPaths.has(skill.path)) {
      throw new PluginLifecycleError(
        'namespace_conflict',
        `清单 provides.skills 内 path "${skill.path}" 重复`,
      );
    }
    skillPaths.add(skill.path);
  }
}

/**
 * 从 PLUGINS_DIR/<dirName>/ 安装插件：读 plugin.json → schema 校验 →
 * 引擎下界检查 → 单事务驱动 discovered→downloaded→verified→installed
 * （verified 步写入 sha256(plugin.json 原文)）。任一步抛错抛给调用方，
 * 事务内的全部写入自动回滚。返回最终 PluginRecord（重读自 DB）。
 */
export function installFromDirectory(dirName: string): PluginRecord {
  const pluginsDir = getPluginsDir();
  if (!pluginsDir) {
    throw new PluginLifecycleError(
      'plugins_dir_not_configured',
      '未配置 PLUGINS_DIR 环境变量，无法从本地目录安装插件',
    );
  }

  const pluginDir = resolvePluginDir(pluginsDir, dirName);
  const manifestPath = join(pluginDir, 'plugin.json');

  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf-8');
  } catch {
    throw new PluginLifecycleError('manifest_not_found', `插件清单不存在或不可读：${manifestPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new PluginLifecycleError(
      'manifest_invalid',
      `插件清单不是合法 JSON：${manifestPath}（${error instanceof Error ? error.message : String(error)}）`,
    );
  }

  const validation = validateManifest(parsed);
  if (!validation.valid) {
    throw new PluginLifecycleError(
      'manifest_invalid',
      `插件清单校验失败：${validation.errors.join('；')}`,
    );
  }
  const manifest = parsed as PluginManifest;

  if (compareSemver(manifest.engineCompatibility.minVersion, HOST_VERSION) > 0) {
    throw new PluginLifecycleError(
      'engine_incompatible',
      `插件要求宿主版本 >= ${manifest.engineCompatibility.minVersion}，当前宿主版本为 ${HOST_VERSION}`,
    );
  }

  const db = getDb();
  const runInstall = db.transaction(() => {
    assertNoInternalConflicts(manifest);

    const pluginId = manifest.name;
    const version = manifest.version;

    createPlugin({ manifest, state: 'discovered', directory: dirName });
    recordSuccess({ pluginId, fromState: null, toState: 'discovered', version, trigger: 'system' });

    updatePluginState(pluginId, 'downloaded');
    recordSuccess({
      pluginId,
      fromState: 'discovered',
      toState: 'downloaded',
      version,
      trigger: 'system',
    });

    const digest = createHash('sha256').update(raw).digest('hex');
    updatePluginState(pluginId, 'verified', undefined, digest);
    recordSuccess({
      pluginId,
      fromState: 'downloaded',
      toState: 'verified',
      version,
      trigger: 'system',
      payload: { digest },
    });

    capabilities.register(getPlugin(pluginId)!, pluginDir);
    updatePluginState(pluginId, 'installed');
    recordSuccess({
      pluginId,
      fromState: 'verified',
      toState: 'installed',
      version,
      trigger: 'system',
    });
  });
  runInstall();

  return getPlugin(manifest.name)!;
}

/**
 * 启用插件（仅 official；community 禁止走该入口）。合法源状态：
 * installed/disabled。装配能力 → 置 enabled → 记 user 触发的成功事件。
 */
export function enablePlugin(pluginId: string): PluginRecord {
  const plugin = getPlugin(pluginId);
  if (!plugin) {
    throw new PluginLifecycleError('plugin_not_found', `插件不存在：${pluginId}`);
  }
  if (plugin.source === 'community') {
    throw new PluginLifecycleError(
      'community_enable_forbidden',
      `社区插件不允许直接启用：${pluginId}（应经市场安装流程）`,
    );
  }
  if (!USER_TRANSITIONS.enable.includes(plugin.state)) {
    throw new PluginLifecycleError(
      'invalid_transition',
      `非法状态转移：enable 不允许从 ${plugin.state} 出发（合法源状态：installed、disabled）`,
    );
  }

  const pluginsDir = getPluginsDir();
  capabilities.register(plugin, pluginsDir ? resolvePluginDir(pluginsDir, plugin.directory) : plugin.directory);
  const updated = updatePluginState(pluginId, 'enabled');
  recordSuccess({
    pluginId,
    fromState: plugin.state,
    toState: 'enabled',
    version: plugin.version,
    trigger: 'user',
  });
  return updated!;
}

/** 禁用插件。合法源状态：enabled。反注册能力 → 置 disabled → 记事件。 */
export function disablePlugin(pluginId: string): PluginRecord {
  const plugin = getPlugin(pluginId);
  if (!plugin) {
    throw new PluginLifecycleError('plugin_not_found', `插件不存在：${pluginId}`);
  }
  if (!USER_TRANSITIONS.disable.includes(plugin.state)) {
    throw new PluginLifecycleError(
      'invalid_transition',
      `非法状态转移：disable 仅允许从 enabled 出发（当前：${plugin.state}）`,
    );
  }

  capabilities.unregister(pluginId);
  const updated = updatePluginState(pluginId, 'disabled');
  recordSuccess({
    pluginId,
    fromState: plugin.state,
    toState: 'disabled',
    version: plugin.version,
    trigger: 'user',
  });
  return updated!;
}

/**
 * 卸载插件（仅 community；official 禁止）。enabled 态先隐式 disable
 * （递归调用 disablePlugin，含独立事件行），随后单事务清除该插件贡献的
 * mcps/skills 行与 plugin_data、置 uninstalled 并记终态事件。
 */
export function uninstallPlugin(pluginId: string): PluginRecord {
  const plugin = getPlugin(pluginId);
  if (!plugin) {
    throw new PluginLifecycleError('plugin_not_found', `插件不存在：${pluginId}`);
  }
  if (plugin.source === 'official') {
    throw new PluginLifecycleError(
      'official_uninstall_forbidden',
      `官方插件不允许卸载：${pluginId}`,
    );
  }
  if (!USER_TRANSITIONS.uninstall.includes(plugin.state)) {
    throw new PluginLifecycleError(
      'invalid_transition',
      `非法状态转移：uninstall 不允许从 ${plugin.state} 出发（uninstalled 为终态）`,
    );
  }

  let current = plugin;
  if (current.state === 'enabled') {
    current = disablePlugin(pluginId);
  }

  const db = getDb();
  const runUninstall = db.transaction(() => {
    deleteMcpsByPlugin(pluginId);
    deleteSkillsByPlugin(pluginId);
    deleteAllData(pluginId);
    updatePluginState(pluginId, 'uninstalled');
    recordSuccess({
      pluginId,
      fromState: current.state,
      toState: 'uninstalled',
      version: plugin.version,
      trigger: 'user',
    });
  });
  runUninstall();

  return getPlugin(pluginId)!;
}
