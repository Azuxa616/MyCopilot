// useChipInput - / 与 @ 的输入接线 hook
// 持有 textarea 文本、chip 数组与触发面板状态；键盘语义：
// 面板打开时 ↑↓/Enter/Tab/Esc 归面板，Backspace 优先整删 chip，
// 面板关闭时 Enter（无 Shift）提交发送。纯逻辑全部委托 chips/model 与
// chips/triggers（两处均有表驱动测试），本 hook 只做状态编排。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type CommandEntry,
  type InputChip,
  type PaletteItem,
  type ReferenceCandidate,
  type SerializedDraft,
  createChip,
  deleteChipAtCaret,
  hasChipToken,
  insertChipToken,
  serializeDraft,
} from '../chips/model'
import {
  CLOSED,
  type ReferenceCategory,
  type TriggerState,
  ascendToCategory,
  descendToItems,
  filterCandidates,
  handleTriggerKeyDown,
  moveSelection,
  updateTriggerOnInput,
} from '../chips/triggers'

export interface UseChipInputOptions {
    /** / 命令候选（skill 有效集，调用方经 api.fetchEffectiveSkills 获取）。 */
    skills: CommandEntry[]
    /** @ 引用候选（资产 + 会话，调用方组装）。 */
    references: ReferenceCandidate[]
    /**
     * 提交发送。返回 false 表示前置校验未过（不清空输入）；
     * 返回 true 后 hook 清空文本与 chips（乐观清空，异步错误由调用方 toast）。
     */
    onSend: (draft: SerializedDraft) => boolean
}

export function useChipInput({ skills, references, onSend }: UseChipInputOptions) {
    const [content, setContent] = useState('')
    const [chips, setChips] = useState<InputChip[]>([])
    const [trigger, setTrigger] = useState<TriggerState>(CLOSED)
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    const pendingCaretRef = useRef<number | null>(null)

    // 程序化改值后的 caret 恢复（chip 插入 / 整删之后）
    useEffect(() => {
        if (pendingCaretRef.current === null) return
        const caret = pendingCaretRef.current
        pendingCaretRef.current = null
        const ta = textareaRef.current
        if (ta) {
            requestAnimationFrame(() => {
                // 兜底聚焦：鼠标点选等路径可能已移走焦点（面板按钮另有
                // onMouseDown preventDefault 主防线）。
                if (document.activeElement !== ta) ta.focus()
                ta.setSelectionRange(caret, caret)
            })
        }
    }, [content])

    // 联合类型收窄快照（deps 数组不能直接访问 trigger.kind 等判别字段）
    const triggerOpen = trigger.open
    const triggerKind = trigger.open ? trigger.kind : null
    const triggerStage = trigger.open && trigger.kind === 'reference' ? trigger.stage : null
    const triggerCategory =
        trigger.open && trigger.kind === 'reference' && trigger.stage === 'items'
            ? trigger.category
            : null

    /** 候选 → 面板条目（command 与 reference 两类）。 */
    const items = useMemo<PaletteItem[]>(() => {
        if (trigger.open && trigger.kind === 'command') {
            return skills.map((s) => ({
                key: `skill-${s.id}`,
                filterText: s.label,
                title: s.label,
                subtitle:
                    [s.description, s.triggers && s.triggers.length > 0 ? `triggers: ${s.triggers.join(', ')}` : undefined]
                        .filter(Boolean)
                        .join(' · ') || undefined,
                badge: 'skill' as const,
                chip: createChip({ kind: 'skill', token: `/${s.label}`, skillName: s.label }),
            }))
        }
        if (trigger.open && trigger.kind === 'reference') {
            // 一级分类层：会话 / 文件（带条目数徽标；无 chip——确认行为是下钻）
            if (trigger.stage === 'category') {
                const defs: Array<{ label: string; category: ReferenceCategory }> = [
                    { label: '会话', category: 'session' },
                    { label: '文件', category: 'file' },
                ]
                return defs.map((d) => ({
                    key: `category-${d.category}`,
                    filterText: d.label,
                    title: d.label,
                    subtitle: `${references.filter((r) => r.kind === d.category).length} 个`,
                    badge: d.category,
                    category: d.category,
                }))
            }
            // 二级条目层：该分类下的具体引用
            return references
                .filter((r) => r.kind === trigger.category)
                .map((r) => ({
                    key: `${r.kind}-${r.id}`,
                    filterText: r.title,
                    title: r.title,
                    subtitle: r.subtitle,
                    badge: r.kind,
                    chip: createChip({ kind: r.kind, token: r.token, assetId: r.assetId, sessionId: r.sessionId }),
                }))
        }
        return []
        // trigger.query 变化即重建（createChip 每次生成新 id，仅在确认时入 state，无稳定性问题）
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [triggerOpen, triggerKind, triggerStage, triggerCategory, skills, references])

    const candidates = useMemo(
        () => (trigger.open ? filterCandidates(items, trigger.query) : []),
        [items, trigger],
    )

    const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value
        const caret = e.target.selectionStart ?? value.length
        setContent(value)
        setTrigger((prev) => updateTriggerOnInput(prev, value, caret, chips.map((c) => c.token)))
    }, [chips])

    const insertItem = useCallback((item: PaletteItem) => {
        // 分类条目（一级）：下钻二级并消费一级过滤词（textarea 截回触发符），
        // caret 紧随其后（"清空重输"语义），二级从全量列表重新过滤。
        if (trigger.open && trigger.kind === 'reference' && trigger.stage === 'category' && item.category) {
            const nextValue = content.slice(0, trigger.triggerStart + 1)
            setContent(nextValue)
            setTrigger((prev) => descendToItems(prev, item.category!))
            pendingCaretRef.current = nextValue.length
            return
        }
        const chip = item.chip
        if (!chip) return
        const token = chip.token
        // token 唯一约束：同名 chip 已存在则仅关面板
        if (hasChipToken(chips, token)) {
            setTrigger(CLOSED)
            return
        }
        const ta = textareaRef.current
        const caret = ta ? (ta.selectionStart ?? content.length) : content.length
        const start = trigger.open ? trigger.triggerStart : caret
        const next = insertChipToken(content, start, caret, token)
        setContent(next.value)
        setChips((prev) => [...prev, chip])
        setTrigger(CLOSED)
        pendingCaretRef.current = next.caret
    }, [chips, content, trigger])

    const submit = useCallback(() => {
        const draft = serializeDraft(content, chips)
        if (!draft.content) return
        if (onSend(draft)) {
            setContent('')
            setChips([])
            setTrigger(CLOSED)
        }
    }, [chips, content, onSend])

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const ta = e.currentTarget
        const caret = ta.selectionStart ?? 0

        // Backspace 优先整删 chip（caret 无选区时）
        if (e.key === 'Backspace' && ta.selectionStart === ta.selectionEnd) {
            const deletion = deleteChipAtCaret(content, chips, caret)
            if (deletion) {
                e.preventDefault()
                setContent(deletion.value)
                setChips((prev) => prev.filter((c) => c.id !== deletion.removedChipId))
                setTrigger(CLOSED)
                pendingCaretRef.current = deletion.caret
                return
            }
        }

        // Backspace 手势：二级且过滤词为空 → 返回一级分类层（不删字符）
        if (
            e.key === 'Backspace' &&
            trigger.open &&
            trigger.kind === 'reference' &&
            trigger.stage === 'items' &&
            trigger.query === '' &&
            ta.selectionStart === ta.selectionEnd
        ) {
            e.preventDefault()
            setTrigger((prev) => ascendToCategory(prev))
            return
        }

        const action = handleTriggerKeyDown(trigger, e.key)
        if (action.type === 'back') {
            e.preventDefault()
            setTrigger((prev) => ascendToCategory(prev))
        } else if (action.type === 'move') {
            e.preventDefault()
            setTrigger((prev) => moveSelection(prev, action.delta, candidates.length))
        } else if (action.type === 'commit') {
            e.preventDefault()
            const item = candidates[trigger.open ? trigger.selectedIndex : 0]
            if (item) insertItem(item)
            else setTrigger(CLOSED)
        } else if (action.type === 'close') {
            e.preventDefault()
            setTrigger(CLOSED)
        } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
        }
    }, [candidates, chips, content, insertItem, submit, trigger])

    const selectItem = useCallback((index: number) => {
        const item = candidates[index]
        if (item) insertItem(item)
    }, [candidates, insertItem])

    const hoverItem = useCallback((index: number) => {
        setTrigger((prev) => (prev.open ? { ...prev, selectedIndex: index } : prev))
    }, [])

    const reset = useCallback(() => {
        setContent('')
        setChips([])
        setTrigger(CLOSED)
    }, [])

    const setTextareaRef = useCallback((el: HTMLTextAreaElement | null) => {
        textareaRef.current = el
    }, [])

    const draft = useMemo(() => serializeDraft(content, chips), [content, chips])

    return {
        content,
        chips,
        trigger,
        candidates,
        draft,
        handleInput,
        handleKeyDown,
        selectItem,
        hoverItem,
        submit,
        reset,
        setTextareaRef,
        // draftStore 一次性草稿注入等外部写入口（plan 外补充，保持既有功能可用）。
        setContent,
    }
}
