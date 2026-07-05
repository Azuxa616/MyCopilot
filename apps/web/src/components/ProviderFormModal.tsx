// ProviderFormModal - Create / Edit provider modal

import { useState, useEffect } from 'react'
import type { Provider, CreateProviderParams } from '@my-copilot/shared'
import Modal from './common/Modal'
import { FormField, formControlClassName } from './common/FormField'

export interface ProviderFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  provider?: Provider;
  onSubmit: (params: CreateProviderParams | Partial<CreateProviderParams>) => void;
}

export default function ProviderFormModal({
  open,
  onOpenChange,
  mode,
  provider,
  onSubmit,
}: ProviderFormModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'openai' | 'ollama'>('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      if (mode === 'edit' && provider) {
        setName(provider.name);
        setType(provider.type);
        setBaseUrl(provider.baseUrl);
        setApiKey(''); // leave empty to keep unchanged
      } else {
        setName('');
        setType('openai');
        setBaseUrl('');
        setApiKey('');
      }
      setErrors({});
    }
  }, [open, mode, provider]);

  const validate = (): boolean => {
    const nextErrors: Record<string, string> = {};
    if (!name.trim()) nextErrors.name = '名称不能为空';
    if (!baseUrl.trim()) {
      nextErrors.baseUrl = 'Base URL 不能为空';
    } else if (!/^https?:\/\//.test(baseUrl.trim())) {
      nextErrors.baseUrl = 'Base URL 必须以 http:// 或 https:// 开头';
    }
    if (mode === 'create' && type === 'openai' && !apiKey.trim()) {
      nextErrors.apiKey = 'OpenAI 类型需要提供 API Key';
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    const params: Partial<CreateProviderParams> = {
      name: name.trim(),
      type,
      baseUrl: baseUrl.trim(),
    };
    if (apiKey.trim()) {
      params.apiKey = apiKey.trim();
    }
    if (mode === 'create') {
      (params as CreateProviderParams).enabled = true;
    }
    onSubmit(params);
    onOpenChange(false);
  };

  const apiKeyLabel = mode === 'edit' && provider?.apiKey
    ? 'API Key（已配置，留空保持不变）'
    : mode === 'edit'
    ? 'API Key（未配置）'
    : 'API Key';

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={mode === 'create' ? '新建 Provider' : '编辑 Provider'}
      width="520px"
    >
      <div className="flex flex-col gap-4">
        <FormField label="名称" required error={errors.name}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={formControlClassName}
            placeholder="例如：OpenAI Production"
          />
        </FormField>

        <FormField label="类型" required>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as 'openai' | 'ollama')}
            className={formControlClassName}
          >
            <option value="openai">OpenAI</option>
            <option value="ollama">Ollama</option>
          </select>
        </FormField>

        <FormField label="Base URL" required error={errors.baseUrl}>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className={formControlClassName}
            placeholder="https://api.openai.com/v1"
          />
        </FormField>

        <FormField label={apiKeyLabel} error={errors.apiKey}>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className={formControlClassName}
            placeholder={mode === 'edit' ? '留空保持不变' : 'sk-...'}
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
