// ModelSelector - 输入框内的模型选择器
// 触发 chip + Popover 面板（向上展开），替代原生 select：
// 原生下拉面板由操作系统渲染，样式与应用主题脱节。

import { useEffect, useRef, useState } from 'react'
// Components
import Popover from '../common/Popover'
import IconChevronDown from '../../assets/icon/chevron-down.svg?react'
import IconCheck from '../../assets/icon/check.svg?react'
// Types
import type { Model, Provider } from '@my-copilot/shared'

interface ModelSelectorProps {
    models: Model[]
    providersMap: Record<string, Provider>
    isLoading: boolean
    value: string | null | undefined
    onChange: (modelId: string) => void
}

/** 拆分模型标签为 Provider 前缀 + 模型名（面板中分行展示） */
function splitLabel(model: Model, providersMap: Record<string, Provider>) {
    const provider = providersMap[model.providerId]
    return {
        provider: provider?.name ?? '',
        name: model.displayName || model.name,
    }
}

/**
 * 紧凑模型选择器
 * chip 触发器嵌入 Sender 工具行，面板按应用主题渲染。
 */
export default function ModelSelector({
    models,
    providersMap,
    isLoading,
    value,
    onChange,
}: ModelSelectorProps) {
    const [open, setOpen] = useState(false)
    const [activeIndex, setActiveIndex] = useState(-1)
    const panelRef = useRef<HTMLDivElement>(null)

    // 面板打开后接管焦点，方向键/Enter/Escape 可用
    useEffect(() => {
        if (open) panelRef.current?.focus()
    }, [open])

    if (isLoading) {
        return <span className="text-xs text-text-tertiary px-2 py-1">加载中...</span>
    }

    const currentModel = models.find((m) => m.id === value)
    const currentLabel = currentModel ? splitLabel(currentModel, providersMap) : null
    const triggerText = currentLabel
        ? (currentLabel.provider ? `${currentLabel.provider} / ${currentLabel.name}` : currentLabel.name)
        : '请选择模型'

    const handleSelect = (modelId: string) => {
        onChange(modelId)
        setOpen(false)
    }

    const handleOpenChange = (next: boolean) => {
        setOpen(next)
        if (next) {
            // 打开时高亮当前选中项
            setActiveIndex(Math.max(0, models.findIndex((m) => m.id === value)))
        } else {
            setActiveIndex(-1)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            setOpen(false)
            return
        }
        if (models.length === 0) return
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActiveIndex((i) => Math.min(models.length - 1, i + 1))
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActiveIndex((i) => Math.max(0, i - 1))
        } else if ((e.key === 'Enter' || e.key === ' ') && activeIndex >= 0) {
            e.preventDefault()
            handleSelect(models[activeIndex].id)
        }
    }

    const panel = (
        <div
            role="listbox"
            aria-label="选择模型"
            tabIndex={-1}
            ref={panelRef}
            onKeyDown={handleKeyDown}
            className="w-60 max-h-64 overflow-y-auto outline-none"
        >
            {models.length === 0 && (
                <div className="px-3 py-2 text-xs text-text-tertiary">暂无可用模型</div>
            )}
            {models.map((model, index) => {
                const label = splitLabel(model, providersMap)
                const selected = model.id === value
                const active = index === activeIndex
                return (
                    <button
                        key={model.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => handleSelect(model.id)}
                        onMouseEnter={() => setActiveIndex(index)}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors ${
                            active ? 'bg-bg-hover' : ''
                        } ${selected ? 'text-primary-500' : 'text-text-primary'}`}
                    >
                        <span className="flex-1 min-w-0">
                            <span className="block text-sm truncate">{label.name}</span>
                            {label.provider && (
                                <span className="block text-[11px] text-text-tertiary truncate">{label.provider}</span>
                            )}
                        </span>
                        {selected && <IconCheck className="w-3.5 h-3.5 shrink-0" />}
                    </button>
                )
            })}
        </div>
    )

    return (
        <Popover
            trigger="click"
            placement="top"
            content={panel}
            open={open}
            onOpenChange={handleOpenChange}
        >
            <button
                type="button"
                title={triggerText}
                aria-haspopup="listbox"
                aria-expanded={open}
                className="flex items-center gap-1 max-w-44 px-2 py-1 text-xs text-text-secondary rounded-lg hover:bg-bg-hover hover:text-text-primary transition-colors"
            >
                <span className="truncate">{triggerText}</span>
                <IconChevronDown className={`w-3 h-3 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
            </button>
        </Popover>
    )
}
