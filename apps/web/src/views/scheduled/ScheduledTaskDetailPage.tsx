import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ScheduledTask, ScheduledTaskRunView } from '@my-copilot/shared';
import { api } from '../../api';
import { ScheduledTaskRunList } from '../../components/ScheduledTask';

export function ScheduledTaskDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState<ScheduledTask | null>(null);
  const [runs, setRuns] = useState<ScheduledTaskRunView[]>([]);
  useEffect(() => { void Promise.all([api.getScheduledTask(id), api.fetchScheduledTaskRuns(id)]).then(([nextTask, nextRuns]) => { setTask(nextTask); setRuns(nextRuns); }); }, [id]);
  const remove = async () => {
    if (!window.confirm('确定删除这个定时任务吗？正在运行和历史记录会保留。')) return;
    await api.deleteScheduledTask(id);
    navigate('/scheduled');
  };
  const run = async () => { const created = await api.runScheduledTaskNow(id); setRuns((current) => [created, ...current]); };
  const toggle = async () => { setTask(task?.status === 'paused' ? await api.resumeScheduledTask(id) : await api.pauseScheduledTask(id)); };
  if (!task) return <div className="p-6 text-sm text-text-secondary">加载中…</div>;
  return <div className="mx-auto max-w-4xl p-6">
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold text-text-primary">{task.name}</h1><p className="mt-1 text-sm text-text-secondary">{task.prompt}</p></div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => void run()} className="rounded-lg border border-border-base px-3 py-2 text-sm text-text-secondary hover:bg-bg-hover">立即运行</button>
        <button onClick={() => void toggle()} className="rounded-lg border border-border-base px-3 py-2 text-sm text-text-secondary hover:bg-bg-hover">{task.status === 'paused' ? '恢复' : '暂停'}</button>
        <Link to={`/scheduled/${id}/edit`} className="rounded-lg border border-border-base px-3 py-2 text-sm text-text-secondary hover:bg-bg-hover">编辑</Link>
        <button onClick={() => void remove()} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-500 hover:bg-red-50">删除</button>
      </div>
    </div>
    <dl className="mb-8 grid gap-3 rounded-xl border border-border-base bg-bg-primary p-4 text-sm md:grid-cols-2"><div><dt className="text-text-tertiary">调度</dt><dd className="mt-1 text-text-primary">{task.scheduleType === 'once' ? new Date(task.runAt!).toLocaleString() : task.cronExpression}</dd></div><div><dt className="text-text-tertiary">下次执行</dt><dd className="mt-1 text-text-primary">{task.nextRunAt ? new Date(task.nextRunAt).toLocaleString() : '无'}</dd></div></dl>
    <h2 className="mb-2 text-lg font-semibold text-text-primary">运行记录</h2><ScheduledTaskRunList runs={runs} />
  </div>;
}
