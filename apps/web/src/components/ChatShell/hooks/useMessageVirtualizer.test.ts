import { describe, it, expect } from 'vitest';
import { shouldAdjustScrollOnResize } from './useMessageVirtualizer';

/**
 * 补偿判定语义（修复"上滑阅读时滑块持续跳动"的核心回归）：
 *
 * TanStack Virtual 默认条件是 `item.start < scrollOffset`——只看条目顶部。
 * 流式消息横跨视口顶部时（start < scrollTop < end），它向下生长并不推移
 * 视口内内容，但默认条件会误判为需要补偿，导致 scrollTop 被程序性累加、
 * 用户被持续下推。正确语义：只有条目【完全位于视口上方】（end <= scrollTop），
 * 其尺寸变化才会推移视口内容，才需要补偿。
 */
describe('shouldAdjustScrollOnResize', () => {
    it('条目完全位于视口上方 → 补偿（上滑浏览历史时实测修正的场景）', () => {
        expect(shouldAdjustScrollOnResize({ start: 0, end: 200 }, 500)).toBe(true);
    });

    it('条目横跨视口顶部（流式增长场景）→ 不补偿', () => {
        // start < scrollTop < end：视口内看到的是消息中部，向下生长不影响它
        expect(shouldAdjustScrollOnResize({ start: 300, end: 3000 }, 1000)).toBe(false);
    });

    it('条目完全在视口内或视口下方 → 不补偿', () => {
        expect(shouldAdjustScrollOnResize({ start: 1200, end: 1500 }, 1000)).toBe(false);
        expect(shouldAdjustScrollOnResize({ start: 5000, end: 6000 }, 1000)).toBe(false);
    });

    it('scrollOffset 未初始化（null）→ 不补偿', () => {
        expect(shouldAdjustScrollOnResize({ start: 0, end: 200 }, null)).toBe(false);
    });

    it('边界：item.end 恰好等于 scrollTop → 视为上方，补偿', () => {
        expect(shouldAdjustScrollOnResize({ start: 0, end: 500 }, 500)).toBe(true);
    });
});
