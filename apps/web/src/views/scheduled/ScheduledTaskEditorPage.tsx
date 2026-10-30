import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Model, ScheduledTaskInput, SessionSummary, SkillMeta } from '@my-copilot/shared';
import { api } from '../../api';
import { ScheduledTaskEditor } from '../../components/ScheduledTask';

export function ScheduledTaskEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [initialValue, setInitialValue] = useState<ScheduledTaskInput | undefined>();
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void Promise.all([api.fetchSessionSummaries(), api.fetchAllModels(), api.fetchSkills()]).then(([s, m, k]) => {
      setSessions(s); setModels(m.filter((model) => model.enabled)); setSkills(k.filter((skill) => skill.enabled));
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    if (id) void api.getScheduledTask(id).then((task) => {
      const { id: _id, status: _status, nextRunAt: _next, deletedAt: _deleted, createdAt: _created, updatedAt: _updated, ...input } = task;
      setInitialValue(input); setLoading(false);
    }).catch((cause) => { setError(cause instanceof Error ? cause.message : String(cause)); setLoading(false); });
  }, [id]);
  const submit = async (input: ScheduledTaskInput) => {
    try { const task = id ? await api.updateScheduledTask(id, input) : await api.createScheduledTask(input); navigate(`/scheduled/${task.id}`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <div className="mx-auto max-w-3xl p-6"><h1 className="mb-6 text-2xl font-semibold text-text-primary">{id ? '编辑定时任务' : '创建定时任务'}</h1>{error ? <p className="mb-4 text-sm text-red-500">{error}</p> : null}{loading ? <p>加载中…</p> : <ScheduledTaskEditor initialValue={initialValue} sessions={sessions} models={models} skills={skills} onSubmit={submit} onCancel={() => navigate(-1)} submitLabel={id ? '保存修改' : '创建任务'} />}</div>;
}
