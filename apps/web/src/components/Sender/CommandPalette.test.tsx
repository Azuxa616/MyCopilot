import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// vitest 未开 globals：RTL 自动清理不生效，沿用 SkillFormModal.test.tsx 的手动 cleanup 约定。
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import CommandPalette from './CommandPalette'
import type { PaletteItem } from './chips/model'

const items: PaletteItem[] = [
    { key: 's1', filterText: 'translate', title: 'translate', subtitle: '翻译文本 · triggers: 翻译', badge: 'skill', chip: {} as never },
    { key: 's2', filterText: 'code-review', title: 'code-review', subtitle: '代码评审', badge: 'skill', chip: {} as never },
]

describe('CommandPalette', () => {
    beforeEach(() => {
        // jsdom 未实现 scrollIntoView，stub 之
        Element.prototype.scrollIntoView = vi.fn();
    });

    afterEach(() => {
        cleanup();
    });

    it('renders items with title/subtitle and highlights selectedIndex', () => {
        render(
            <CommandPalette items={items} selectedIndex={1} query="re" onSelect={vi.fn()} onHover={vi.fn()} />,
        )
        expect(screen.getByText('translate')).toBeTruthy()
        expect(screen.getByText('code-review')).toBeTruthy()
        expect(screen.getByText('翻译文本 · triggers: 翻译')).toBeTruthy()
        // 选中项有高亮类
        const selected = screen.getByText('code-review').closest('button')
        expect(selected?.className).toContain('bg-primary-50')
    })

    it('click invokes onSelect with the index', () => {
        const onSelect = vi.fn()
        render(<CommandPalette items={items} selectedIndex={0} query="" onSelect={onSelect} onHover={vi.fn()} />)
        fireEvent.click(screen.getByText('code-review'))
        expect(onSelect).toHaveBeenCalledWith(1)
    })

    it('empty items renders the no-match hint', () => {
        render(<CommandPalette items={[]} selectedIndex={0} query="zzz" onSelect={vi.fn()} onHover={vi.fn()} />)
        expect(screen.getByText('无匹配的 skill')).toBeTruthy()
    })

    it('selectedIndex 变化时对选中项调用 scrollIntoView（滚动跟随）', () => {
        const { rerender } = render(
            <CommandPalette items={items} selectedIndex={0} query="" onSelect={vi.fn()} onHover={vi.fn()} />,
        );
        rerender(
            <CommandPalette items={items} selectedIndex={1} query="" onSelect={vi.fn()} onHover={vi.fn()} />,
        );
        expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });
})
