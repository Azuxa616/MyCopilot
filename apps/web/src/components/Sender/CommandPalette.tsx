// CommandPalette - / 命令面板（skill 目录：name / description / triggers）
// 纯展示组件：候选过滤与键盘状态由 useChipInput 持有，本组件只渲染 + 上报。

import type { PaletteItem } from './chips/model'

interface CommandPaletteProps {
    items: PaletteItem[]
    selectedIndex: number
    query: string
    onSelect: (index: number) => void
    onHover: (index: number) => void
}

export default function CommandPalette({ items, selectedIndex, query, onSelect, onHover }: CommandPaletteProps) {
    return (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border-base bg-bg-elevated shadow-lg">
            <div className="border-b border-border-base px-3 py-1.5 text-xs text-text-tertiary">
                命令 <span className="font-mono">/{query}</span>
            </div>
            {items.length === 0 ? (
                <div className="px-3 py-3 text-sm text-text-tertiary">无匹配的 skill</div>
            ) : (
                <ul>
                    {items.map((item, index) => (
                        <li key={item.key}>
                            <button
                                type="button"
                                onClick={() => onSelect(index)}
                                onMouseEnter={() => onHover(index)}
                                className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors ${
                                    index === selectedIndex ? 'bg-primary-50' : 'hover:bg-bg-hover'
                                }`}
                            >
                                <span className="font-mono text-sm text-text-primary">{item.title}</span>
                                {item.subtitle && (
                                    <span className="line-clamp-2 text-xs text-text-secondary">{item.subtitle}</span>
                                )}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
