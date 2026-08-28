/**
 * eval 进程装配（todo 8）：builtin 工具注册、deterministic 捕获 adapter、
 * live provider 解析。runner 只负责编排，本模块负责构造执行环境。
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ChatMessage, AdapterConfig, ProviderAdapter } from '../llm/base.js';
import { getAdapter } from '../llm/index.js';
import { createFakeAdapter, TEST_ADAPTER_CONFIG } from '../llm/testing/fake-adapter.js';
import { listProviders } from '../repo/provider.js';
import { listAllEnabledModels } from '../repo/model.js';
import { registerTool, listRegisteredTools } from '../tools/registry.js';
import { builtinExecutors } from '../tools/builtins/index.js';
import { initDatabase } from '../db/index.js';
import type { EvalScenario, StreamEvent, Tool } from '@my-copilot/shared';

/** 构造好的执行环境：广告给 LLM 的工具 + adapter 及其连接配置。 */
export interface EvalAdapterPlan {
  adapter: ProviderAdapter;
  adapterConfig: AdapterConfig;
  /** deterministic 捕获代理记录的每次装配消息快照（live 恒为空数组）。 */
  assembledMessages: ChatMessage[][];
}

/** 镜像 apps/server/src/index.ts:117-128 的 registerBuiltInTools 注册循环（eval CLI 是独立入口，不经过 server boot）。 */
export function registerEvalTools(): void {
  for (const { name, executor } of builtinExecutors) {
    try {
      registerTool(name, executor);
    } catch {
      // 已注册（重复调用）——与 index.ts 相同的防御。
    }
  }
}

/** 按 scenario.tools 过滤 builtin 注册表；缺工具即场景/环境配置错误。 */
export function selectScenarioTools(scenario: EvalScenario): Tool[] {
  const registered = new Map(listRegisteredTools().map((tool) => [tool.name, tool]));
  return scenario.tools.map((name) => {
    const tool = registered.get(name);
    if (!tool) {
      throw new Error(
        `场景 ${scenario.id} 需要的工具 "${name}" 未注册（检查 requiredEnv 注入与 builtin 注册表）`,
      );
    }
    return tool;
  });
}

/**
 * deterministic：FakeAdapter 脚本回放 + 捕获代理。
 *
 * 捕获代理记录每次 chatCompletionStream 的装配消息（含 L2 摘要调用），
 * degraded 断言据此校验最终装配消息的截断后缀（禁止用 trace 的
 * resultPreview 断言——截断只作用于装配副本）。
 */
export function buildDeterministicAdapter(
  script: StreamEvent[][],
): EvalAdapterPlan {
  const fake = createFakeAdapter(script);
  const assembledMessages: ChatMessage[][] = [];
  return {
    adapter: {
      type: 'openai',
      chatCompletionStream: (messages, config, options) => {
        assembledMessages.push(messages.map((m) => ({ ...m })));
        return fake.chatCompletionStream(messages, config, options);
      },
    },
    // fake 不消费 config，仅满足接口透传。
    adapterConfig: TEST_ADAPTER_CONFIG,
    assembledMessages,
  };
}

/**
 * live：从用户数据目录（只读）解析 enabled provider + model。
 * 打开用户库 → 取连接配置（纯数据）→ 由调用方切回 eval 临时库；
 * deterministic 路径绝不触碰用户 providers 表。
 */
export function resolveLiveAdapterPlan(providerId?: string): EvalAdapterPlan {
  const sourceDir = resolve(process.env.MYCOPILOT_DATA_DIR || './data');
  if (!existsSync(sourceDir)) {
    throw new Error(
      `live 场景需要用户数据库，但数据目录不存在：${sourceDir}（可用 MYCOPILOT_DATA_DIR 指定）`,
    );
  }
  initDatabase(sourceDir);
  const enabled = listProviders().filter((p) => p.enabled);
  const provider = providerId
    ? enabled.find((p) => p.id === providerId)
    : enabled[0];
  if (!provider) {
    throw new Error(
      `live 场景没有可用 provider（${sourceDir} 中无 enabled${providerId ? ` 且 id=${providerId}` : ''} 的 provider）`,
    );
  }
  const model = listAllEnabledModels().find(
    (m) => m.providerId === provider.id && m.enabled,
  );
  if (!model) {
    throw new Error(`provider ${provider.id}（${provider.name}）没有启用模型`);
  }
  return {
    adapter: getAdapter(provider.type),
    adapterConfig: {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: model.name,
    },
    assembledMessages: [],
  };
}
