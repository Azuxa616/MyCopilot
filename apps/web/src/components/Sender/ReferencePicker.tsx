// ReferencePicker - @ 引用浮层（@file 资产 + @会话 两类对象合并列表）
// 纯展示组件；badge 区分对象类型（file / session）。

import type { PaletteItem } from './chips/model'

interface ReferencePickerProps {
    items: PaletteItem[]
    selectedIndex: number
    query: string
    onSelect: (index: number) => void
    onHover: (index: number) => void
}

const BADGE_LABEL: Record<string, string> = {
    file: '文件',
    session: '会话',
}

export default function ReferencePicker({ items, selectedIndex, query, onSelect, onHover }: ReferencePickerProps) {
    return (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border-base bg-bg-elevated shadow-lg">
            <div className="border-b border-border-base px-3 py-1.5 text-xs text-text-tertiary">
                引用 <span className="font-mono">@{query}</span>
            </div>
            {items.length === 0 ? (
                <div className="px-3 py-3 text-sm text-text-tertiary">无匹配的文件或会话</div>
            ) : (
                <ul>
                    {items.map((item, index) => (
                        <li key={item.key}>
                            <button
                                type="button"
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
