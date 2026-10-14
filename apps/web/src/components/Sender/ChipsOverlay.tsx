// ChipsOverlay - chip 覆盖层
// 与 textarea 同字体/同内边距/同行高的镜像层：chip token 行渲染为 chip 胶囊
// （不透明，完整覆盖底层 token 文本），其余行渲染透明文本以保持行位对齐。
// chip 展示文本 = token 原文（Task 9 模型约束：保证覆盖宽度不小于底层文本）。

import { annotateLines, type InputChip } from './chips/model'

export default function ChipsOverlay({ value, chips }: { value: string; chips: InputChip[] }) {
    if (chips.length === 0) return null

    return (
        <div
            aria-hidden
            className="pointer-events-none absolute inset-0 p-2 text-base leading-6 whitespace-pre-wrap break-words text-transparent"
        >
            {annotateLines(value, chips).map((line, i) => (
                <div key={i} className="min-h-6">
                    {line.type === 'chip' ? (
                        <span className="inline-flex max-w-full items-center truncate rounded-md border border-primary-200 bg-primary-50 px-1.5 align-baseline text-primary-700">
                            {line.chip.label}
                        </span>
                    ) : (
                        <span>{line.text.length > 0 ? line.text : '\u00A0'}</span>
                    )}
                </div>
            ))}
        </div>
    )
}
