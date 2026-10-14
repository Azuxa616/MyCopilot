// ReferencePicker - @ 引用浮层（两级：分类层 → 条目层）
// 纯展示组件；一级列分类（会话/文件 + 条目数），二级列具体条目（badge 区分类型）。

import { useRef } from 'react'
import type { PaletteItem } from './chips/model'
import { useScrollSelectedIntoView } from './hooks/useScrollSelectedIntoView'

interface ReferencePickerProps {
    /** 当前层级：category = 一级分类层；items = 二级条目层。 */
    stage: 'category' | 'items'
    items: PaletteItem[]
    selectedIndex: number
    query: string
    /** items 层的分类名（面包屑，如 '会话'）。 */
    categoryLabel?: string
    onSelect: (index: number) => void
    onHover: (index: number) => void
}

const BADGE_LABEL: Record<string, string> = {
    file: '文件',
    session: '会话',
}

export default function ReferencePicker({ stage, items, selectedIndex, query, categoryLabel, onSelect, onHover }: ReferencePickerProps) {
    const listRef = useRef<HTMLDivElement | null>(null)
    useScrollSelectedIntoView(listRef, selectedIndex)

    const header = stage === 'items' && categoryLabel
        ? `引用 @${categoryLabel}${query ? ` ${query}` : ''}`
        : `引用 @${query}`

    return (
        <div ref={listRef} className="absolute bottom-full left-0 right-0 z-20 mb-1 max-h-64 overflow-y-auto rounded-lg border border-border-base bg-bg-elevated shadow-lg">
            <div className="border-b border-border-base px-3 py-1.5 text-xs text-text-tertiary">
                {header}
            </div>
            {items.length === 0 ? (
                <div className="px-3 py-3 text-sm text-text-tertiary">
                    {stage === 'category' ? '无匹配的分类' : '无匹配的文件或会话'}
                </div>
            ) : stage === 'category' ? (
                <ul>
                    {items.map((item, index) => (
                        <li key={item.key}>
                            <button
                                type="button"
                                data-index={index}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => onSelect(index)}
                                onMouseEnter={() => onHover(index)}
                                className={`flex w-full items-center justify-between px-3 py-2 text-left transition-colors ${
                                    index === selectedIndex ? 'bg-primary-50' : 'hover:bg-bg-hover'
                                }`}
                            >
                                <span className="text-sm text-text-primary">{item.title}</span>
                                {item.subtitle && (
                                    <span className="shrink-0 rounded bg-bg-secondary px-1.5 py-0.5 text-xs text-text-secondary">
                                        {item.subtitle}
                                    </span>
                                )}
                            </button>
                        </li>
                    ))}
                </ul>
            ) : (
                <ul>
                    {items.map((item, index) => (
                        <li key={item.key}>
                            <button
                                type="button"
                                data-index={index}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => onSelect(index)}
                                onMouseEnter={() => onHover(index)}
                                className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                                    index === selectedIndex ? 'bg-primary-50' : 'hover:bg-bg-hover'
                                }`}
                            >
                                <span className="shrink-0 rounded bg-bg-secondary px-1.5 py-0.5 text-xs text-text-secondary">
                                    {BADGE_LABEL[item.badge] ?? item.badge}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm text-text-primary">{item.title}</span>
                                    {item.subtitle && (
                                        <span className="block truncate text-xs text-text-tertiary">{item.subtitle}</span>
                                    )}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
