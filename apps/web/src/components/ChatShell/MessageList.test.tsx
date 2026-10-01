import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { useRef } from 'react';
import { render, cleanup } from '@testing-library/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Virtualizer } from '@tanstack/react-virtual';
import { MessageRole, MessageStatus } from '@my-copilot/shared';
import type { Message } from '@my-copilot/shared';
import MessageList from './MessageList';

// MessageCard 拉入 Markdown/Alert/Avatar 全家桶，与本测试的虚拟化契约无关。
vi.mock('../common/MessageCard', () => ({
    default: () => <div data-testid="message-card" />,
}));

const ITEM_SIZE = 100;
const VIEWPORT_HEIGHT = 400;

/** jsdom 未实现 ResizeObserver；提供 no-op 桩让 TanStack Virtual 完成初始化。 */
class ResizeObserverStub implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}

const originalOffsetHeight = Object.getOwnPropertyDescriptor(
    HTMLDivElement.prototype,
    'offsetHeight',
);
const originalOffsetWidth = Object.getOwnPropertyDescriptor(
    HTMLDivElement.prototype,
    'offsetWidth',
);

let virtualizerRef: Virtualizer<HTMLDivElement, Element> | null = null;

function makeMessages(count: number): Message[] {
    return Array.from({ length: count }, (_, i) => ({
        id: `msg-${i}`,
        sessionId: 's1',
        role: MessageRole.USER,
        content: `message ${i}`,
        attachments: [],
        status: MessageStatus.SENT,
        createdAt: i,
    }));
}

/** 用真实 useVirtualizer 驱动 MessageList；measureElement 固定返回，绕过 jsdom 零布局。 */
function Harness({ messages }: { messages: Message[] }) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    // 与 useMessageVirtualizer 相同的库已知限制豁免
    // eslint-disable-next-line react-hooks/incompatible-library
    const virtualizer = useVirtualizer<HTMLDivElement, Element>({
        count: messages.length,
        getScrollElement: () => containerRef.current,
        estimateSize: () => ITEM_SIZE,
        overscan: 15,
        measureElement: () => ITEM_SIZE,
        getItemKey: (i) => messages[i]?.id ?? i,
    });
    virtualizerRef = virtualizer;
    return (
        <MessageList
            revealed={true}
            messages={messages}
            virtualizer={virtualizer}
            containerRef={containerRef}
            onRegenerate={() => {}}
        />
    );
}

beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
    // TanStack Virtual 的 getRect 读取 offsetWidth/offsetHeight（jsdom 不做布局，恒为 0，
    // 会让虚拟化器认为视口高度为 0 → range 为空）。桩出视口尺寸。
    Object.defineProperty(HTMLDivElement.prototype, 'offsetHeight', {
        get: () => VIEWPORT_HEIGHT,
        configurable: true,
    });
    Object.defineProperty(HTMLDivElement.prototype, 'offsetWidth', {
        get: () => 800,
        configurable: true,
    });
});

afterAll(() => {
    if (originalOffsetHeight) {
        Object.defineProperty(HTMLDivElement.prototype, 'offsetHeight', originalOffsetHeight);
    }
    if (originalOffsetWidth) {
        Object.defineProperty(HTMLDivElement.prototype, 'offsetWidth', originalOffsetWidth);
    }
});

// vitest 未启用 globals，RTL 无法自动注册 cleanup，DOM 会跨用例累积
afterEach(cleanup);

describe('MessageList 虚拟滚动渲染契约', () => {
    it('渲染单个 height=totalSize 的定位 wrapper，虚拟条目都挂在其内部', () => {
        const messages = makeMessages(50);
        render(<Harness messages={messages} />);
        const virtualizer = virtualizerRef!;

        expect(virtualizer.scrollElement).not.toBeNull();

        const totalSize = virtualizer.getTotalSize();
        const wrapper = Array.from(document.querySelectorAll('div')).find(
            (d) => d.style.height === `${totalSize}px`,
        );
        expect(wrapper).toBeTruthy();
        expect(wrapper!.querySelectorAll('[data-index]').length).toBeGreaterThan(0);
    });

    it('不得原地反转 getVirtualItems() 返回的 memoized 数组', () => {
        const messages = makeMessages(50);
        const { rerender } = render(<Harness messages={messages} />);
        const virtualizer = virtualizerRef!;

        const items = virtualizer.getVirtualItems();
        const indexesBefore = items.map((i) => i.index);
        // 初始应为升序
        expect(indexesBefore).toEqual([...indexesBefore].sort((a, b) => a - b));

        // 同 props 重渲染：若组件原地 reverse，memoized 数组会在此翻转
        rerender(<Harness messages={messages} />);
        expect(items.map((i) => i.index)).toEqual(indexesBefore);
    });

    it('只渲染虚拟范围内的条目，而非全量消息', () => {
        const messages = makeMessages(50);
        render(<Harness messages={messages} />);
        const rendered = document.querySelectorAll('[data-index]');
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered.length).toBeLessThan(messages.length);
    });
});
