import { describe, it, expect } from 'vitest';
import { DEFAULT_PLUGIN_BUDGET } from '../plugin.js';
import type {
  LifecycleState,
  LifecycleTrigger,
  PluginLifecycleEvent,
  PluginManifest,
  PluginType,
} from '../plugin.js';

describe('DEFAULT_PLUGIN_BUDGET', () => {
  it('should have correct values', () => {
    expect(DEFAULT_PLUGIN_BUDGET.toolCallTimeoutMs).toBe(30000);
    expect(DEFAULT_PLUGIN_BUDGET.lifecycleHookTimeoutMs).toBe(5000);
    expect(DEFAULT_PLUGIN_BUDGET.startupTimeoutMs).toBe(10000);
  });
});

describe('plugin types', () => {
  it('should accept all seven LifecycleState values', () => {
    const states: LifecycleState[] = [
      'discovered',
      'downloaded',
      'verified',
      'installed',
      'enabled',
      'disabled',
      'uninstalled',
    ];
    expect(states).toHaveLength(7);
    expect(new Set(states).size).toBe(7);
  });

  it('should accept valid union values', () => {
    const type: PluginType = 'frontend-response';
    const customType: PluginType = 'future-unknown-type';
    const trigger: LifecycleTrigger = 'rollback';
    expect(type).toBe('frontend-response');
    expect(customType).toBe('future-unknown-type');
    expect(trigger).toBe('rollback');
  });

  it('should create a valid PluginLifecycleEvent', () => {
    const event: PluginLifecycleEvent = {
      eventId: 'evt-1',
      type: 'installed',
      pluginId: 'my-plugin',
      version: '1.0.0',
      timestamp: 1787000000000,
      fromState: 'verified',
      toState: 'installed',
      trigger: 'user',
      result: { status: 'success' },
    };
    expect(event.toState).toBe('installed');
    expect(event.result.status).toBe('success');
  });

  it('should create a valid PluginManifest', () => {
    const manifest: PluginManifest = {
      name: 'my-plugin',
      version: '1.0.0',
      description: '示例插件',
      author: { name: 'alice' },
      license: 'MIT',
      engineCompatibility: { minVersion: '0.1.0' },
      source: 'community',
      permissions: { tools: true },
      provides: { skills: [{ path: 'skills/foo.md' }] },
    };
    expect(manifest.provides.skills?.[0]?.path).toBe('skills/foo.md');
    expect(manifest.source).toBe('community');
  });
});
