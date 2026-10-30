import { Link } from 'react-router-dom';
import type { ScheduledTask } from '@my-copilot/shared';

interface Props {
  tasks: ScheduledTask[];
  onPause: (id: string) => Promise<void>;
  onResume: (id: string) => Promise<void>;
  onRun: (id: string) => Promise<void>;
}
const statusText = { active: '已启用', paused: '已暂停', completed: '调度完成' } as const;
export function ScheduledTaskList({ tasks, onPause, onResume, onRun }: Props) {
  if (tasks.length === 0) return <div className="rounded-xl border border-dashed border-border-base p-10 text-center text-sm text-text-secondary">还没有定时任务，创建第一个让 Agent 按计划工作。</div>;
  return <div className="flex flex-col gap-3">{tasks.map((task) => (
    <article key={task.id} className="rounded-xl border border-border-base bg-bg-primary p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to={`/scheduled/${task.id}`} className="text-base font-semibold text-text-primary hover:text-primary-500">{task.name}</Link>
          <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{task.prompt}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-text-tertiary">
            <span>{statusText[task.status]}</span><span>·</span><span>{task.scheduleType === 'once' ? '单次' : task.cronExpression}</span><span>·</span><span>{task.targetType === 'new_session' ? '每次新对话' : '依附已有对话'}</span>
          </div>
        </div>
        <div className="flex gap-2 text-sm">
          <button onClick={() => void onRun(task.id)} className="rounded-lg border border-border-base px-3 py-1.5 text-text-secondary hover:bg-bg-hover">立即运行</button>
          {task.status === 'paused'
            ? <button onClick={() => void onResume(task.id)} className="rounded-lg border border-border-base px-3 py-1.5 text-primary-500 hover:bg-bg-hover">恢复</button>
            : <button onClick={() => void onPause(task.id)} className="rounded-lg border border-border-base px-3 py-1.5 text-text-secondary hover:bg-bg-hover">暂停</button>}
        </div>
      </div>
    </article>
  ))}</div>;
}
