import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
// vitest 未开 globals：RTL 自动清理不生效，沿用 SkillFormModal.test.tsx 的手动 cleanup 约定。
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ReferencePicker from './ReferencePicker'
import type { PaletteItem } from './chips/model'

const categoryItems: PaletteItem[] = [
    { key: 'category-session', filterText: '会话', title: '会话', subtitle: '46 个', badge: 'session', category: 'session' },
    { key: 'category-file', filterText: '文件', title: '文件', subtitle: '3 个', badge: 'file', category: 'file' },
]

const sessionItems: PaletteItem[] = [
    { key: 'session-s1', filterText: '调研记录', title: '调研记录', subtitle: '12 条消息', badge: 'session', chip: {} as never },
    { key: 'session-s2', filterText: '长会话压测（mock）', title: '长会话压测（mock）', subtitle: '122 条消息', badge: 'session', chip: {} as never },
]

describe('ReferencePicker（两级）', () => {
    beforeEach(() => {
        // jsdom 未实现 scrollIntoView，stub 之
        Element.prototype.scrollIntoView = vi.fn()
    })

    afterEach(() => {
        cleanup()
    })

    it('category 层：渲染分类条目与数量徽标', () => {
        render(
            <ReferencePicker stage="category" items={categoryItems} selectedIndex={0} query="" onSelect={vi.fn()} onHover={vi.fn()} />,
        )
        expect(screen.getByText('会话')).toBeTruthy()
        expect(screen.getByText('46 个')).toBeTruthy()
        expect(screen.getByText('文件')).toBeTruthy()
        expect(screen.getByText('3 个')).toBeTruthy()
        expect(screen.getByText('引用 @')).toBeTruthy()
    })

    it('items 层：渲染条目与类型徽标，header 带分类面包屑', () => {
        render(
            <ReferencePicker stage="items" items={sessionItems} selectedIndex={1} query="调" categoryLabel="会话" onSelect={vi.fn()} onHover={vi.fn()} />,
        )
        expect(screen.getByText('调研记录')).toBeTruthy()
        expect(screen.getByText('122 条消息')).toBeTruthy()
        expect(screen.getByText('引用 @会话 调')).toBeTruthy()
        // 选中项高亮
        const selected = screen.getByText('长会话压测（mock）').closest('button')
        expect(selected?.className).toContain('bg-primary-50')
    })

    it('点击分类条目上报 onSelect（下钻由 hook 层完成）', () => {
        const onSelect = vi.fn()
        render(
            <ReferencePicker stage="category" items={categoryItems} selectedIndex={0} query="" onSelect={onSelect} onHover={vi.fn()} />,
        )
        fireEvent.click(screen.getByText('文件'))
        expect(onSelect).toHaveBeenCalledWith(1)
    })

    it('selectedIndex 变化时对选中项调用 scrollIntoView（滚动跟随）', () => {
        const { rerender } = render(
            <ReferencePicker stage="items" items={sessionItems} selectedIndex={0} query="" categoryLabel="会话" onSelect={vi.fn()} onHover={vi.fn()} />,
        )
        rerender(
            <ReferencePicker stage="items" items={sessionItems} selectedIndex={1} query="" categoryLabel="会话" onSelect={vi.fn()} onHover={vi.fn()} />,
        )
        expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    })
})
