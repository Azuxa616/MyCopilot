// ModelFormModal - Create / Edit model modal

import { useState, useEffect } from 'react'
import type { Model, CreateModelParams } from '@my-copilot/shared'
import Modal from './common/Modal'
import { FormField, formControlClassName } from './common/FormField'

export interface ModelFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  model?: Model;
  onSubmit: (params: CreateModelParams | Partial<CreateModelParams>) => void;
}

export default function ModelFormModal({
  open,
  onOpenChange,
  mode,
  model,
  onSubmit,
}: ModelFormModalProps) {
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      if (mode === 'edit' && model) {
        setName(model.name);
        setDisplayName(model.displayName || '');
      } else {
        setName('');
        setDisplayName('');
      }
      setErrors({});
    }
  }, [open, mode, model]);

  const validate = (): boolean => {
    const nextErrors: Record<string, string> = {};
    if (!name.trim()) nextErrors.name = '模型标识不能为空';
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    const params: Partial<CreateModelParams> = {
      name: name.trim(),
    };
    if (displayName.trim()) {
      params.displayName = displayName.trim();
    }
    onSubmit(params);
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={mode === 'create' ? '新建模型' : '编辑模型'}
      width="480px"
    >
      <div className="flex flex-col gap-4">
        {/* Model identifier */}
        <FormField label="模型标识" required error={errors.name}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={formControlClassName}
            placeholder="例如：gpt-4o"
          />
        </FormField>

        {/* Display name */}
        <FormField label="显示名称">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={formControlClassName}
            placeholder="例如：GPT-4o"
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
