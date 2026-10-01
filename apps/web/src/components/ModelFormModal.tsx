// ModelFormModal - Create / Edit model modal

import { useState } from 'react'
import type { Model, CreateModelParams } from '@my-copilot/shared'
import Modal from './common/Modal'
import { FormField, formControlClassName } from './common/FormField'
import { api } from '../api'
import { describeVisionCapability } from '../utils/capability'
import { getRelativeTime } from '../utils/time'
import { showMessageAlert } from './common/Alert/alertUtils'

export interface ModelFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  model?: Model;
  onSubmit: (params: CreateModelParams | Partial<CreateModelParams>) => void;
  /** 能力区块内探测/手动设置成功后回传最新模型（供列表刷新徽标）。 */
  onModelUpdated?: (model: Model) => void;
}

export default function ModelFormModal({
  open,
  onOpenChange,
  mode,
  model,
  onSubmit,
  onModelUpdated,
}: ModelFormModalProps) {
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  // 能力区块的本地快照（探测/手动设置后即时刷新，不依赖保存）
  const [capModel, setCapModel] = useState<Model | undefined>(undefined);
  const [isProbing, setIsProbing] = useState(false);

  // Reset form when the modal opens.
  // 渲染期守卫式状态调整（react.dev "You Might Not Need an Effect"），
  // 哨兵 null 保证首帧即执行，与原 mount effect 行为一致。
  const [hydratedFor, setHydratedFor] = useState<{
    open: boolean
    mode: 'create' | 'edit'
    model: Model | undefined
  } | null>(null)
  if (
    hydratedFor === null ||
    hydratedFor.open !== open ||
    hydratedFor.mode !== mode ||
    hydratedFor.model !== model
  ) {
    setHydratedFor({ open, mode, model })
    if (open) {
      if (mode === 'edit' && model) {
        setName(model.name);
        setDisplayName(model.displayName || '');
      } else {
        setName('');
        setDisplayName('');
      }
      setErrors({});
      setCapModel(mode === 'edit' ? model : undefined);
    }
  }

  const capInfo = describeVisionCapability(capModel?.capabilities);
  const capStatusLine = capInfo.vision === 'unknown' && !capInfo.source
    ? '当前：未知（未记录）'
    : `当前：${capInfo.label}${capModel?.capabilities?.probedAt ? ` · ${getRelativeTime(capModel.capabilities.probedAt)}` : ''}`;

  const handleProbe = async () => {
    if (!model || !capModel) return;
    setIsProbing(true);
    try {
      const { model: updated, probe } = await api.probeModelVision(model.id);
      setCapModel(updated);
      onModelUpdated?.(updated);
      if (probe.locked) {
        showMessageAlert.error('该模型能力已被手动锁定；如需改判，请先将"图片输入"选为"自动"清除锁定');
      } else if (probe.vision === 'yes') {
        showMessageAlert.success('探测成功：该模型支持图片输入');
      } else if (probe.vision === 'no') {
        showMessageAlert.success('探测完成：该模型不支持图片输入（已记录）');
      } else {
        showMessageAlert.success('探测完成：未能确定（保持未知）');
      }
    } catch (error) {
      console.error('Failed to probe vision capability:', error);
      showMessageAlert.error(error instanceof Error ? error.message : '探测失败');
    } finally {
      setIsProbing(false);
    }
  };

  const handleVisionChange = async (vision: 'yes' | 'no' | 'unknown') => {
    if (!model || !capModel) return;
    try {
      const updated = await api.setModelVision(model.id, vision === 'unknown' ? null : vision);
      setCapModel(updated);
      onModelUpdated?.(updated);
      showMessageAlert.success(vision === 'unknown' ? '已清除能力设置（回到未知）' : '已手动设置；此后不再被自动反写覆盖');
    } catch (error) {
      console.error('Failed to set vision capability:', error);
      showMessageAlert.error('设置失败');
    }
  };

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

        {/* Capability section（仅编辑模式；低频诊断与最终仲裁收于此） */}
        {mode === 'edit' && model && capModel && (
          <div className="flex flex-col gap-2 p-3 bg-bg-tertiary border border-border-base rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-text-secondary">能力</span>
              <span className="text-xs text-text-tertiary">{capStatusLine}</span>
            </div>
            <div className="flex items-center gap-2">
              <select
                aria-label={`${model.name} 图片输入能力`}
                value={capInfo.vision}
                onChange={(e) => void handleVisionChange(e.target.value as 'yes' | 'no' | 'unknown')}
                className="flex-1 px-2 py-1.5 text-xs bg-bg-secondary border border-border-base text-text-primary rounded-lg"
              >
                <option value="unknown">图片输入：自动</option>
                <option value="yes">图片输入：支持</option>
                <option value="no">图片输入：不支持</option>
              </select>
              <button
                onClick={() => void handleProbe()}
                disabled={isProbing}
                title="向该模型发送一张纯色小图并验证其能否说出颜色（答案验证式探测）"
                className="px-3 py-1.5 text-xs bg-bg-secondary border border-border-base text-text-primary rounded-lg hover:border-primary-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {isProbing ? '探测中…' : '测试图片输入'}
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-text-tertiary">
              「自动」交由系统判定；手动选择后成为最终判定，不再被自动反写覆盖。探测仅发送一张 32×32 纯色小图。
            </p>
          </div>
        )}

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
