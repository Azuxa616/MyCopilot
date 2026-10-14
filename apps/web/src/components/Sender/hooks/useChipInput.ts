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
  buildReferenceItems,
  createChip,
  deleteChipAtCaret,
  hasChipToken,
  insertChipToken,
  serializeDraft,
  splitAfterChipToken,
} from '../chips/model'
import {
  CLOSED,
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
    const triggerQuery = trigger.open ? trigger.query : ''
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
            // 两级 + 一级全局搜索的组装规则见 buildReferenceItems（model 层表驱动测试）。
            return buildReferenceItems(
                trigger.stage,
                trigger.stage === 'items' ? trigger.category : null,
                trigger.query,
                references,
            )
        }
        return []
        // trigger.query 变化即重建（createChip 每次生成新 id，仅在确认时入 state，无稳定性问题）
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [triggerOpen, triggerKind, triggerStage, triggerCategory, triggerQuery, skills, references])

    const candidates = useMemo(
        () => (trigger.open ? filterCandidates(items, trigger.query) : []),
        [items, trigger],
    )

    const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const raw = e.target.value
        const rawCaret = e.target.selectionStart ?? raw.length
        const skillTokens = chips.filter((c) => c.kind === 'skill').map((c) => c.token)
        // skill chip 行尾输入保护：新字符拆到下一行，chip 恒独占一行。
        // 拆行后新行的触发符（如 @）照常重算面板。
        const split = splitAfterChipToken(content, raw, rawCaret, skillTokens)
        const value = split ? split.value : raw
        const caret = split ? split.caret : rawCaret
        if (split) pendingCaretRef.current = split.caret
        setContent(value)
        setTrigger((prev) => updateTriggerOnInput(prev, value, caret, skillTokens))
    }, [chips, content])

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

        // 引用条目（二级下钻或一级全局搜索）：不进 textarea——删除触发文本
        // [triggerStart, caret)，chip 以卡片形态挂在输入框上方（去重按 kind+id）。
        if (chip.kind === 'file' || chip.kind === 'session') {
            const payloadId = chip.sessionId ?? chip.assetId
            const dup = chips.some(
                (c) => c.kind === chip.kind && (c.sessionId ?? c.assetId) === payloadId,
            )
            if (dup) {
                setTrigger(CLOSED)
                return
            }
            const ta = textareaRef.current
            const caret = ta ? (ta.selectionStart ?? content.length) : content.length
            const start = trigger.open ? trigger.triggerStart : caret
            const nextValue = content.slice(0, start) + content.slice(caret)
            setContent(nextValue)
            setChips((prev) => [...prev, chip])
            setTrigger(CLOSED)
            pendingCaretRef.current = start
            return
        }

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
            const deletion = deleteChipAtCaret(content, chips.filter((c) => c.kind === 'skill'), caret)
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

    const skillChips = useMemo(() => chips.filter((c) => c.kind === 'skill'), [chips])

    /** 移除 ref chip（卡片 × 按钮）。 */
    const removeChip = useCallback((id: string) => {
        setChips((prev) => prev.filter((c) => c.id !== id))
    }, [])

    const draft = useMemo(() => serializeDraft(content, chips), [content, chips])

    return {
        content,
        chips,
        skillChips,
        trigger,
        candidates,
        draft,
        handleInput,
        handleKeyDown,
        selectItem,
        hoverItem,
        submit,
        reset,
        removeChip,
        setTextareaRef,
        // draftStore 一次性草稿注入等外部写入口（plan 外补充，保持既有功能可用）。
        setContent,
    }
}
