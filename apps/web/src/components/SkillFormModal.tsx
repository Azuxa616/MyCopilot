// SkillFormModal - Create skill modal with two input modes: Upload (.md file) and Paste (textarea).
// Both modes parse the text for a simple YAML frontmatter (`---\nname: ...\ndescription: ...\n---`)
// to show a hint and auto-fill the name/description fields. The server re-parses on submit;
// this preview is best-effort and frontend-only.

import { useState, useMemo } from 'react'
import type { CreateSkillParams, SkillDetail, SkillSource, UpdateSkillParams } from '@my-copilot/shared'
import Modal from './common/Modal'
import { FormField, formControlClassName } from './common/FormField'

export interface SkillFormModalProps {
  open: boolean
  onClose: () => void
  onSave: (params: CreateSkillParams) => void
  /** 编辑模式：要编辑的 skill（null/undefined = 新建）。directory 来源由调用方屏蔽。 */
  editing?: SkillDetail | null
  onUpdate?: (id: string, params: UpdateSkillParams) => void
}

type Mode = 'upload' | 'paste'

// ─── Frontmatter preview parsing (frontend hint only; server is source of truth) ───

interface FrontmatterHint {
  name?: string
  description?: string
}

/**
 * Best-effort YAML-ish frontmatter parser. Matches an opening `---` line, captures
 * `name:` and `description:` keys (single-line), and requires a closing `---`.
 * This is intentionally lenient — only used to show a hint and pre-fill inputs.
 */
function parseFrontmatterHint(text: string): FrontmatterHint {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/)
  if (!match) return {}
  const block = match[1]
  const result: FrontmatterHint = {}
  for (const line of block.split('\n')) {
    const m = line.match(/^(\w+)\s*:\s*(.+?)\s*$/)
    if (!m) continue
    const [, key, raw] = m
    // strip surrounding quotes if present
    const value = raw.replace(/^['"]/, '').replace(/['"]$/, '')
    if (key === 'name') result.name = value
    else if (key === 'description') result.description = value
  }
  return result
}

/** 创建模板：点击填入骨架（frontmatter 字段为契约，占位内容可读即可）。 */
const TEMPLATES: Record<string, string> = {
  代码评审: `---\nname: code-review\ndescription: 逐文件评审代码变更，输出结构化问题清单与修复建议\ntriggers:\n  - 评审\n  - code review\n---\n\n## 评审步骤\n1. 阅读变更范围，列出涉及文件\n2. 按正确性/安全性/可读性逐项检查\n3. 输出问题清单（级别 + 位置 + 建议）`,
  写作风格: `---\nname: writing-style\ndescription: 以简洁技术写作风格润色文本\n---\n\n## 风格要点\n- 短句优先，一段一个要点\n- 术语保持一致\n- 代码标识符用原文不翻译`,
  翻译规范: `---\nname: translation\ndescription: 中英互译时保留术语与代码标识符原文\n---\n\n## 规范\n- 代码标识符、API 名、产品名保留原文\n- 长句拆分，符合目标语言习惯\n- 不确定的术语先列出供确认`,
}

export default function SkillFormModal({
  open,
  onClose,
  onSave,
  editing = null,
  onUpdate,
}: SkillFormModalProps) {
  const [mode, setMode] = useState<Mode>('upload')
  const [fileName, setFileName] = useState<string>('')
  const [content, setContent] = useState<string>('') // raw markdown body (file or paste)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [autoFilled, setAutoFilled] = useState(false) // tracks whether name/desc came from frontmatter

  // Reset everything when modal opens
  // 渲染期守卫式状态调整（react.dev "You Might Not Need an Effect"），
  // 哨兵 null 保证首帧即执行，与原 mount effect 行为一致。
  const [lastOpen, setLastOpen] = useState<boolean | null>(null)
  if (lastOpen !== open) {
    setLastOpen(open)
    if (open) {
      setMode('upload')
      setFileName('')
      setContent('')
      setName('')
      setDescription('')
      setErrors({})
      setAutoFilled(false)
      if (editing) {
        setName(editing.name)
        setDescription(editing.description)
        setContent(editing.content)
        setAutoFilled(false)
      }
    }
  }

  // Live frontmatter hint (recomputed on every content change)
  const hint = useMemo(() => parseFrontmatterHint(content), [content])

  // ─── File upload handler ───
  const handleFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const text = await file.text()
    setContent(text)
    // auto-fill name/description from frontmatter if present
    const parsed = parseFrontmatterHint(text)
    setName(parsed.name ?? '')
    setDescription(parsed.description ?? '')
    setAutoFilled(Boolean(parsed.name || parsed.description))
  }

  // ─── Paste handler ───
  const handlePasteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value
    setContent(text)
    // auto-fill only if name/description are still empty (don't clobber user edits)
    const parsed = parseFrontmatterHint(text)
    if (!name && parsed.name) {
      setName(parsed.name)
      setAutoFilled(true)
    }
    if (!description && parsed.description) {
      setDescription(parsed.description)
      setAutoFilled(true)
    }
  }

  const validate = (): boolean => {
    const next: Record<string, string> = {}
    if (!name.trim()) next.name = '名称不能为空'
    if (!description.trim()) next.description = '描述不能为空'
    if (!content.trim()) next.content = '内容不能为空'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = () => {
    if (!validate()) return
    if (editing && onUpdate) {
      onUpdate(editing.id, {
        name: name.trim(),
        description: description.trim(),
        body: content,
      })
    } else {
      const params: CreateSkillParams = {
        name: name.trim(),
        description: description.trim(),
        body: content,
        source: 'upload' as SkillSource,
        enabled: true,
      }
      onSave(params)
    }
    onClose()
  }

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={editing ? '编辑 Skill' : '新建 Skill'} width="640px">
      <div className="flex flex-col gap-4">
        {/* Mode toggle */}
        <div className="flex gap-2 p-1 bg-bg-secondary rounded-lg border border-border-base">
          {(['upload', 'paste'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                mode === m
                  ? 'bg-bg-elevated text-text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {m === 'upload' ? '上传文件' : '粘贴文本'}
            </button>
          ))}
        </div>

        {!editing && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-text-tertiary">模板：</span>
            {Object.keys(TEMPLATES).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setMode('paste')
                  setContent(TEMPLATES[key]!)
                  const parsed = parseFrontmatterHint(TEMPLATES[key]!)
                  setName(parsed.name ?? '')
                  setDescription(parsed.description ?? '')
                  setAutoFilled(true)
                  setFileName('')
                }}
                className="px-2.5 py-1 text-xs bg-bg-secondary border border-border-base rounded-full hover:border-primary-400 transition-colors"
              >
                {key}
              </button>
            ))}
          </div>
        )}

        {/* Content input */}
        <FormField label="Skill 内容 (.md)" required error={errors.content}>
          {mode === 'upload' ? (
            <div className="flex flex-col gap-2">
              <label className="flex items-center justify-center px-4 py-6 border-2 border-dashed border-border-base rounded-lg cursor-pointer hover:border-primary-400 hover:bg-bg-hover transition-colors text-sm text-text-secondary">
                <input
                  type="file"
                  accept=".md,.markdown,text/markdown,text/plain"
                  onChange={handleFileChange}
                  className="hidden"
                />
                {fileName ? (
                  <span className="text-text-primary font-medium">
                    {fileName}
                  </span>
                ) : (
                  <span>点击选择 .md 文件</span>
                )}
              </label>
            </div>
          ) : (
            <textarea
              value={content}
              onChange={handlePasteChange}
              className={`${formControlClassName} min-h-[180px] resize-y font-mono text-xs`}
              placeholder={`---\nname: my-skill\ndescription: What this skill does\n---\n\nSkill body content...`}
            />
          )}
        </FormField>

        {/* Frontmatter hint */}
        {content && (hint.name || hint.description) && (
          <div className="px-3 py-2 bg-primary-50 border border-primary-200 rounded-lg text-xs text-primary-700">
            <div className="font-medium mb-0.5">已检测到 frontmatter：</div>
            <div>
              name: <span className="font-mono">{hint.name ?? '—'}</span>
              {'  ·  '}
              description:{' '}
              <span className="font-mono">{hint.description ?? '—'}</span>
            </div>
          </div>
        )}

        {/* Name + Description (editable; auto-filled from frontmatter) */}
        <FormField label="名称" required error={errors.name}>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setAutoFilled(false)
            }}
            className={formControlClassName}
            placeholder="例如：my-skill"
          />
        </FormField>

        <FormField label="描述" required error={errors.description}>
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              setAutoFilled(false)
            }}
            className={`${formControlClassName} min-h-[60px] resize-y`}
            placeholder="Skill 用途描述"
          />
        </FormField>

        {autoFilled && (
          <span className="text-xs text-text-tertiary italic">
            名称/描述已从 frontmatter 自动填充，可直接编辑
          </span>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 mt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-primary bg-bg-secondary border border-border-base rounded-lg hover:bg-bg-hover transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors font-medium"
          >
            {editing ? '保存' : '创建'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
