import { useEffect, useState } from 'react';
import type { Model, ScheduledTaskInput, SessionSummary, SkillMeta } from '@my-copilot/shared';
import { api } from '../../api';

export interface ScheduledTaskEditorProps {
  initialValue?: ScheduledTaskInput;
  sessions: SessionSummary[];
  models: Model[];
  skills: SkillMeta[];
  onSubmit: (value: ScheduledTaskInput) => void | Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
}

function localDateTimeValue(timestamp: number): string {
  const date = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

export function ScheduledTaskEditor({ initialValue, sessions, models, skills, onSubmit, onCancel, submitLabel = '创建任务' }: ScheduledTaskEditorProps) {
  const [value, setValue] = useState<ScheduledTaskInput>(() => initialValue ?? {
    name: '', prompt: '', scheduleType: 'once', runAt: Date.now() + 86_400_000,
    cronExpression: null, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    targetType: 'new_session', targetSessionId: null,
    modelId: models[0]?.id ?? '', enforcedSkillIds: [],
  });
  const [previewNextRunAt, setPreviewNextRunAt] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void api.previewScheduledTask(value).then((next) => { if (active) setPreviewNextRunAt(next); }).catch(() => { if (active) setPreviewNextRunAt(null); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [value]);
  const patch = <K extends keyof ScheduledTaskInput>(key: K, next: ScheduledTaskInput[K]) => setValue((current) => ({ ...current, [key]: next }));
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void onSubmit({ ...value, modelId: value.modelId || models[0]?.id || '' });
  };
  const inputClass = 'w-full rounded-lg border border-border-base bg-bg-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-200';
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" aria-label="定时任务编辑器">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm text-text-secondary">任务名称
          <input aria-label="任务名称" required maxLength={200} className={`${inputClass} mt-1.5`} value={value.name} onChange={(e) => patch('name', e.target.value)} />
        </label>
        <label className="text-sm text-text-secondary">执行模型
          <select aria-label="执行模型" required className={`${inputClass} mt-1.5`} value={value.modelId || models[0]?.id || ''} onChange={(e) => patch('modelId', e.target.value)}>
            {models.map((model) => <option key={model.id} value={model.id}>{model.displayName || model.name}</option>)}
          </select>
        </label>
      </div>
      <label className="text-sm text-text-secondary">执行指令
        <textarea aria-label="执行指令" required rows={5} className={`${inputClass} mt-1.5 resize-y`} value={value.prompt} onChange={(e) => patch('prompt', e.target.value)} placeholder="每次运行时，Agent 需要完成什么？" />
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm text-text-secondary">调度方式
          <select aria-label="调度方式" className={`${inputClass} mt-1.5`} value={value.scheduleType} onChange={(e) => {
            const scheduleType = e.target.value as ScheduledTaskInput['scheduleType'];
            setValue((current) => ({ ...current, scheduleType, runAt: scheduleType === 'once' ? current.runAt ?? Date.now() + 86_400_000 : null, cronExpression: scheduleType === 'cron' ? current.cronExpression ?? '0 9 * * *' : null }));
          }}>
            <option value="once">单次执行</option><option value="cron">周期执行</option>
          </select>
        </label>
        <label className="text-sm text-text-secondary">时区
          <input aria-label="时区" required className={`${inputClass} mt-1.5`} value={value.timezone} onChange={(e) => patch('timezone', e.target.value)} />
        </label>
      </div>
      {value.scheduleType === 'once' ? (
        <label className="text-sm text-text-secondary">执行时间
          <input aria-label="执行时间" type="datetime-local" required className={`${inputClass} mt-1.5`} value={value.runAt ? localDateTimeValue(value.runAt) : ''} onChange={(e) => patch('runAt', new Date(e.target.value).getTime())} />
        </label>
      ) : (
        <label className="text-sm text-text-secondary">Cron 表达式
          <input aria-label="Cron 表达式" required className={`${inputClass} mt-1.5 font-mono`} value={value.cronExpression ?? ''} onChange={(e) => patch('cronExpression', e.target.value)} placeholder="0 9 * * 1-5" />
        </label>
      )}
      <label className="text-sm text-text-secondary">依附对话
        <select aria-label="依附对话" className={`${inputClass} mt-1.5`} value={value.targetType === 'new_session' ? 'new_session' : value.targetSessionId ?? ''} onChange={(e) => {
          const target = e.target.value;
          setValue((current) => ({ ...current, targetType: target === 'new_session' ? 'new_session' : 'existing_session', targetSessionId: target === 'new_session' ? null : target }));
        }}>
          <option value="new_session">每次运行创建新对话</option>
          {sessions.map((session) => <option key={session.id} value={session.id}>{session.title} · {new Date(session.updatedAt).toLocaleDateString()}</option>)}
        </select>
      </label>
      <label className="text-sm text-text-secondary">显式 Skills（可多选）
        <select aria-label="显式 Skills" multiple className={`${inputClass} mt-1.5 min-h-20`} value={value.enforcedSkillIds} onChange={(e) => patch('enforcedSkillIds', Array.from(e.target.selectedOptions, (option) => option.value))}>
          {skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
        </select>
      </label>
      <div className="text-xs text-text-tertiary" aria-live="polite">{previewNextRunAt ? `下次执行：${new Date(previewNextRunAt).toLocaleString()}` : '填写完整调度信息后显示下次执行时间'}</div>
      <div className="flex justify-end gap-2 border-t border-border-base pt-4">
        {onCancel ? <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-text-secondary hover:bg-bg-hover">取消</button> : null}
        <button type="submit" className="rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600">{submitLabel}</button>
      </div>
    </form>
  );
}
