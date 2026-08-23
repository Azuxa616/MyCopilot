// ToolInputSchemaEditor - Dynamic fields-array editor for a Tool's inputSchema.
// Renders one row per field (name / type / description / required) with add/remove actions.

import type { ToolInputSchema, ToolInputSchemaField } from '@my-copilot/shared'
import { formControlClassName } from './common/FormField'

export interface ToolInputSchemaEditorProps {
  value: ToolInputSchema
  onChange: (schema: ToolInputSchema) => void
  readonly?: boolean
}

const FIELD_TYPES: ToolInputSchemaField['type'][] = [
  'string',
  'number',
  'boolean',
  'object',
  'array',
]

const emptyField = (): ToolInputSchemaField => ({
  name: '',
  type: 'string',
  description: '',
  required: false,
})

export default function ToolInputSchemaEditor({
  value,
  onChange,
  readonly = false,
}: ToolInputSchemaEditorProps) {
  const fields = value.fields ?? []

  const updateField = (index: number, patch: Partial<ToolInputSchemaField>) => {
    const next = fields.map((f, i) => (i === index ? { ...f, ...patch } : f))
    onChange({ fields: next })
  }

  const addField = () => {
    onChange({ fields: [...fields, emptyField()] })
  }

  const removeField = (index: number) => {
    onChange({ fields: fields.filter((_, i) => i !== index) })
  }

  return (
    <div className="flex flex-col gap-2">
      {fields.length === 0 && (
        <div className="text-xs text-text-tertiary italic px-1 py-2">
          暂无参数字段
        </div>
      )}

      {fields.map((field, index) => (
        <div
          key={index}
          className="grid grid-cols-12 gap-2 items-center p-2 bg-bg-secondary border border-border-base rounded-lg"
        >
          {/* name */}
          <input
            type="text"
            value={field.name}
            onChange={(e) => updateField(index, { name: e.target.value })}
            disabled={readonly}
            placeholder="参数名"
            className={`${formControlClassName} col-span-3 px-2 py-1.5 disabled:opacity-60`}
          />

          {/* type */}
          <select
            value={field.type}
            onChange={(e) =>
              updateField(index, {
                type: e.target.value as ToolInputSchemaField['type'],
              })
            }
            disabled={readonly}
            className={`${formControlClassName} col-span-2 px-2 py-1.5 disabled:opacity-60`}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          {/* description */}
          <input
            type="text"
            value={field.description}
            onChange={(e) => updateField(index, { description: e.target.value })}
            disabled={readonly}
            placeholder="描述"
            className={`${formControlClassName} col-span-4 px-2 py-1.5 disabled:opacity-60`}
          />

          {/* required */}
          <label className="col-span-2 flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={field.required}
              onChange={(e) => updateField(index, { required: e.target.checked })}
              disabled={readonly}
              className="w-4 h-4 accent-primary-500 disabled:opacity-60"
            />
            必填
          </label>

          {/* remove */}
          <button
            type="button"
            onClick={() => removeField(index)}
            disabled={readonly}
            className="col-span-1 text-xs text-error-600 hover:text-error-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="删除字段"
          >
            ✕
          </button>
        </div>
      ))}

      {!readonly && (
        <button
          type="button"
          onClick={addField}
          className="self-start px-3 py-1.5 text-xs bg-bg-primary border border-border-base text-text-primary rounded-lg hover:bg-bg-hover transition-colors"
        >
          + 添加字段
        </button>
      )}
    </div>
  )
}
