/**
 * 共享 FakeProviderAdapter（llm/testing/fake-adapter.ts）单元测试。
 *
 * 三场景（对齐 todo 5 验收）：
 *   1. 多轮脚本 —— 每轮 chatCompletionStream 依序弹出下一轮事件，保序回放
 *   2. 轮次耗尽 —— 脚本用尽后再被调用抛「回放脚本太短」
 *   3. abort 传播 —— options.signal 中断后流以错误终止（对齐真实 adapter
 *      的 fetch abort → 流抛 AbortError 行为）
 */
import { describe, it, expect } from 'vitest';
import type { StreamEvent } from '@my-copilot/shared';
import {
  createFakeAdapter,
  recordFromEvents,
  TEST_ADAPTER_CONFIG,
} from '../testing/fake-adapter.js';

async function collectEvents(
  gen: AsyncGenerator<StreamEvent, void, unknown>,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

describe('createFakeAdapter', () => {
  it('多轮脚本：每轮 chatCompletionStream 依序弹出下一轮事件并保序', async () => {
    const round1: StreamEvent[] = [
      { type: 'reasoning', text: '先想一想' },
      { type: 'tool_call_start', index: 0 },
      {
        type: 'tool_call_delta',
        index: 0,
        id: 'call-1',
        name: 'calc',
        argumentsDelta: '{"x"',
      },
      {
        type: 'tool_call_done',
        index: 0,
        id: 'call-1',
        name: 'calc',
        arguments: '{"x":1}',
      },
      { type: 'finish', reason: 'tool_calls' },
    ];
    const round2: StreamEvent[] = [
      { type: 'content', text: '上下文太长了' },
      { type: 'finish', reason: 'length' },
    ];
    const round3: StreamEvent[] = [
      { type: 'content', text: '完成' },
      { type: 'finish', reason: 'stop' },
    ];
    const adapter = createFakeAdapter([round1, round2, round3]);

    // 断言值取自输入脚本（非输出回推）：三轮依序回放、逐事件相等。
    await expect(
      collectEvents(adapter.chatCompletionStream([], TEST_ADAPTER_CONFIG)),
    ).resolves.toEqual(round1);
    await expect(
      collectEvents(adapter.chatCompletionStream([], TEST_ADAPTER_CONFIG, {})),
    ).resolves.toEqual(round2);
    await expect(
      collectEvents(adapter.chatCompletionStream([], TEST_ADAPTER_CONFIG)),
    ).resolves.toEqual(round3);
  });

  it('轮次耗尽：脚本用尽后再被调用抛「回放脚本太短」', async () => {
    const adapter = createFakeAdapter([[{ type: 'finish', reason: 'stop' }]]);

    // Given：第 1 轮正常回放
    await collectEvents(adapter.chatCompletionStream([], TEST_ADAPTER_CONFIG));

    // When/Then：第 2 轮无脚本可弹 → 同步抛错（可在调用点被捕获）
    expect(() =>
      adapter.chatCompletionStream([], TEST_ADAPTER_CONFIG),
    ).toThrow(/回放脚本太短/);
  });

  it('abort 传播：options.signal 中断后流以错误终止', async () => {
    const ac = new AbortController();
    const adapter = createFakeAdapter([
      [
        { type: 'content', text: 'a' },
        { type: 'content', text: 'b' },
        { type: 'finish', reason: 'stop' },
      ],
    ]);

    const gen = adapter.chatCompletionStream([], TEST_ADAPTER_CONFIG, {
      signal: ac.signal,
    });

    // Given：首个事件已消费、尚未 abort
    expect((await gen.next()).value).toEqual({ type: 'content', text: 'a' });

    // When：消费途中外部 abort
    ac.abort();

    // Then：下一次拉取以错误终止（不静默截断）
    await expect(gen.next()).rejects.toThrow(/abort/i);
  });
});

describe('recordFromEvents', () => {
  it('事件序列转异步生成器，顺序与内容一致（generatorFrom 平替）', async () => {
    const events: StreamEvent[] = [
      { type: 'reasoning', text: '推理增量' },
      { type: 'content', text: '你好' },
      { type: 'finish', reason: 'stop' },
    ];

    await expect(collectEvents(recordFromEvents(events))).resolves.toEqual(
      events,
    );
  });
});
