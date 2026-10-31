import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Model, ScheduledTaskDraft, ScheduledTaskInput, SessionSummary, SkillMeta } from '@my-copilot/shared';
import { api } from '../../api';
import { useSessionStore } from '../../store/sessionStore';
import { ScheduledTaskEditor } from './ScheduledTaskEditor';

interface Props {
  draft: ScheduledTaskDraft;
  sessions: SessionSummary[];
  models: Model[];
  skills: SkillMeta[];
}
export function ScheduledTaskDraftCard({ draft, sessions, models, skills }: Props) {
  const upsert = useSessionStore((state) => state.upsertScheduledTaskDraft);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedTaskId, setConfirmedTaskId] = useState(draft.confirmedTaskId);
  const busyRef = useRef(false);
  const confirm = async (input: ScheduledTaskInput) => {
    if (busyRef.current) return;
    busyRef.current = true; setSubmitting(true); setError(null);
    try {
      const result = await api.confirmScheduledTaskDraft(draft.id, input);
      upsert(result.draft); setConfirmedTaskId(result.task.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { busyRef.current = false; setSubmitting(false); }
  };
  const cancel = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setSubmitting(true);
    try { upsert(await api.cancelScheduledTaskDraft(draft.id)); }
    finally { busyRef.current = false; setSubmitting(false); }
  };
  if (confirmedTaskId) return <div className="m-4 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-700">定时任务已创建。<Link to={`/scheduled/${confirmedTaskId}`} className="ml-2 font-medium underline">查看任务</Link></div>;
  return <section className="m-4 rounded-xl border border-primary-200 bg-bg-elevated p-4 shadow-sm" aria-label="定时任务创建确认卡片">
    <header className="mb-4"><h3 className="text-base font-semibold text-text-primary">确认定时任务</h3><p className="mt-1 text-sm text-text-secondary">Agent 仅生成了草稿。请检查或修改，确认后才会创建。</p></header>
    {error ? <p className="mb-3 text-sm text-red-500">{error}</p> : null}
    <ScheduledTaskEditor initialValue={draft.proposedPayload} sessions={sessions} models={models} skills={skills} onSubmit={confirm} onCancel={() => void cancel()} submitLabel={submitting ? '创建中…' : '确认创建'} />
  </section>;
}
