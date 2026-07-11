// ToolFormModal - Create / Edit tool modal.
// Fields: name, description, type (select), dangerLevel (select), inputSchema (fields editor).

import { useState, useEffect } from 'react'
import type {
  Tool,
  ToolType,
  DangerLevel,
  ToolInputSchema,
  CreateToolParams,
} from '@my-copilot/shared'
import Modal from './common/Modal'
import { FormField, formControlClassName } from './common/FormField'
import ToolInputSchemaEditor from './ToolInputSchemaEditor'

export interface ToolFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  tool?: Tool;
  onSubmit: (
    params: CreateToolParams | Partial<CreateToolParams>,
  ) => void;
}

const TOOL_TYPES: ToolType[] = ['built-in', 'mcp-provided']
const DANGER_LEVELS: DangerLevel[] = ['low', 'medium', 'high']

const emptySchema = (): ToolInputSchema => ({ fields: [] })

export default function ToolFormModal({
  open,
  onOpenChange,
  mode,
  tool,
  onSubmit,
}: ToolFormModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<ToolType>('mcp-provided')
  const [dangerLevel, setDangerLevel] = useState<DangerLevel>('low')
  const [inputSchema, setInputSchema] = useState<ToolInputSchema>(emptySchema())
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      if (mode === 'edit' && tool) {
        setName(tool.name)
        setDescription(tool.description)
        setType(tool.type)
        setDangerLevel(tool.dangerLevel)
        setInputSchema({
          fields: tool.inputSchema.fields.map((f) => ({ ...f })),
        })
      } else {
        setName('')
        setDescription('')
        setType('mcp-provided')
        setDangerLevel('low')
        setInputSchema(emptySchema())
      }
      setErrors({})
    }
  }, [open, mode, tool])

  // Built-in tools expose a read-only type select.
  const isTypeLocked = mode === 'edit' && tool?.type === 'built-in'

  const validate = (): boolean => {
    const nextErrors: Record<string, string> = {}
    if (!name.trim()) nextErrors.name = '名称不能为空'
    // Field names within the schema must be unique and non-empty when present.
    const fieldNames = inputSchema.fields.map((f) => f.name.trim())
    const seen = new Set<string>()
    fieldNames.forEach((n, i) => {
      if (!n) {
        nextErrors.inputSchema = `第 ${i + 1} 个字段名称不能为空`
      } else if (seen.has(n)) {
        nextErrors.inputSchema = `字段名称重复：${n}`
      } else {
        seen.add(n)
      }
    })
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSubmit = () => {
    if (!validate()) return
    const params: Partial<CreateToolParams> = {
      name: name.trim(),
      description: description.trim(),
      type,
      dangerLevel,
      inputSchema: {
        fields: inputSchema.fields.map((f) => ({
          name: f.name.trim(),
          type: f.type,
          description: f.description,
          required: f.required,
        })),
      },
    }
    if (mode === 'create') {
      (params as CreateToolParams).enabled = true
    }
    onSubmit(params)
    onOpenChange(false)
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={mode === 'create' ? '新建 Tool' : '编辑 Tool'}
      width="640px"
    >
      <div className="flex flex-col gap-4">
        <FormField label="名称" required error={errors.name}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={formControlClassName}
            placeholder="例如：web_search"
          />
        </FormField>

        <FormField label="描述" required>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={`${formControlClassName} min-h-[72px] resize-y`}
            placeholder="工具功能描述，供模型理解何时调用"
          />
        </FormField>

        <div className="grid grid-cols-2 gap-4">
          <FormField label="类型" required>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ToolType)}
              disabled={isTypeLocked}
              className={`${formControlClassName} disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              {TOOL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="危险等级" required>
            <select
              value={dangerLevel}
              onChange={(e) => setDangerLevel(e.target.value as DangerLevel)}
              className={formControlClassName}
            >
              {DANGER_LEVELS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <FormField label="输入参数 Schema" error={errors.inputSchema}>
          <ToolInputSchemaEditor
            value={inputSchema}
            onChange={setInputSchema}
          />
        </FormField>

        {/* Actions */}
        <div className="flex justify-end gap-3 mt-2">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm text-text-primary bg-bg-secondary border border-border-base rounded-lg hover:bg-bg-hover transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors font-medium"
          >
            {mode === 'create' ? '创建' : '保存'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
