import { useNavigate } from 'react-router-dom';
import type { ScheduledTaskRunView } from '@my-copilot/shared';
import { useSessionStore } from '../../store/sessionStore';

export function ScheduledTaskRunList({ runs }: { runs: ScheduledTaskRunView[] }) {
  const navigate = useNavigate();
  const selectSession = useSessionStore((state) => state.setSelectedSessionId);
  if (runs.length === 0) return <p className="text-sm text-text-secondary">尚无运行记录。</p>;
  return <div className="flex flex-col divide-y divide-border-base">{runs.map((run) => (
    <div key={run.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
      <div><span className="font-medium text-text-primary">{run.status}</span><span className="ml-3 text-text-tertiary">{new Date(run.createdAt).toLocaleString()}</span>{run.dispatchError ? <p className="mt-1 text-red-500">{run.dispatchError}</p> : null}</div>
      {run.sessionId ? <button className="text-primary-500 hover:underline" onClick={() => { selectSession(run.sessionId!); navigate('/'); }}>查看对话</button> : null}
    </div>
  ))}</div>;
}
