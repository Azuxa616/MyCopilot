import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { Message } from '@my-copilot/shared';
import { MessageRole, MessageStatus } from '@my-copilot/shared';
import MessageCard from '../MessageCard';

// 图片经 useAssetUrl 的鉴权 objectURL 渲染——单测直接 mock 该 hook
vi.mock('../hooks/useAssetUrl', () => ({
    useAssetUrl: vi.fn(() => 'blob:fake-url'),
}));

// MessageCard 拉入 Markdown/Alert/Avatar/icon 资源全家桶，与本测试的
// parts 渲染契约无关（先例：MessageList.test.tsx 对 MessageCard 整体 mock）。
// 注意：vi.mock 路径相对测试文件（__tests__/），非 MessageCard.tsx。
vi.mock('../../MarkdownRenderer', () => ({ default: () => <div /> }));
vi.mock('../Avatar', () => ({ default: () => null }));
vi.mock('../MessageActions', () => ({ default: () => null }));
vi.mock('../AgentTimeline', () => ({ default: () => null }));
vi.mock('../../../assets/icon/retry.svg?react', () => ({ default: () => null }));
vi.mock('../../../assets/img/avatar-user.png', () => ({ default: 'avatar-user' }));
vi.mock('../../../assets/img/avatar-ai.svg', () => ({ default: 'avatar-ai' }));

function makeMessage(overrides: Partial<Message> = {}): Message {
    return {
        id: 'm1',
        sessionId: 's1',
        role: MessageRole.USER,
        content: '[图片: a.png]\n看这张图',
        attachments: [],
        status: MessageStatus.SENT,
        createdAt: Date.now(),
        ...overrides,
    };
}

describe('MessageCard 多模态渲染', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    // vitest 未开 globals：RTL 不会自动 cleanup，手动清（先例 MessageList.test.tsx）
    afterEach(() => {
        cleanup();
    });

    it('含图片 parts 的用户消息：文本 run + 图片直显（parts 优先于 content 投影）', () => {
        render(
            <MessageCard
                message={makeMessage({
                    parts: [
                        { type: 'image', assetId: 'a1' },
                        { type: 'text', text: '看这张图' },
                    ],
                })}
            />,
        );

        const img = screen.getByAltText('图片附件') as HTMLImageElement;
        expect(img.getAttribute('src')).toBe('blob:fake-url');
        // 文本 run 渲染 parts 中的文本，而非 content 投影（不含 [图片: ...] 占位）
        expect(screen.getByText('看这张图')).toBeTruthy();
        expect(screen.queryByText(/\[图片:/)).toBeNull();
    });

    it('纯文本用户消息：走 content 渲染（投影兜底，零回归）', () => {
        render(<MessageCard message={makeMessage({ parts: undefined, content: '纯文本' })} />);
        expect(screen.getByText('纯文本')).toBeTruthy();
        expect(screen.queryByAltText('图片附件')).toBeNull();
    });

    it('点击图片触发 onOpenAsset（内容栏打开预留）', () => {
        const onOpenAsset = vi.fn();
        render(
            <MessageCard
                message={makeMessage({ parts: [{ type: 'image', assetId: 'a1' }] })}
                onOpenAsset={onOpenAsset}
            />,
        );
        fireEvent.click(screen.getByAltText('图片附件'));
        expect(onOpenAsset).toHaveBeenCalledWith('a1');
    });
});
