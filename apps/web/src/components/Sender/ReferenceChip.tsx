// ReferenceChip - @ 引用卡片（会话 / 文件）
// 挂在输入框上方（仿附件区），× 按钮移除；不占用输入文本（区别于 skill chip
// 的 token 行 + overlay 形态）。

import type { InputChip } from './chips/model'
// Assets
import IconDelete from '../../assets/icon/delete.svg?react'

const KIND_LABEL: Record<string, string> = {
    file: '文件',
    session: '会话',
}

interface ReferenceChipProps {
    chip: InputChip
    onRemove: (id: string) => void
}

export default function ReferenceChip({ chip, onRemove }: ReferenceChipProps) {
    return (
        <div className="flex items-center gap-1.5 rounded-md border border-primary-200 bg-primary-50 px-2 py-1 text-xs group">
            <span className="shrink-0 rounded bg-bg-secondary px-1 py-0.5 text-[10px] text-text-secondary">
                {KIND_LABEL[chip.kind] ?? chip.kind}
            </span>
            <span className="max-w-48 truncate text-primary-700" title={chip.label}>
                {chip.label}
            </span>
            <button
                type="button"
                onClick={() => onRemove(chip.id)}
                className="shrink-0 text-text-tertiary hover:text-text-secondary transition-colors"
                title="移除引用"
            >
                <IconDelete className="w-3 h-3" />
            </button>
        </div>
    )
}
