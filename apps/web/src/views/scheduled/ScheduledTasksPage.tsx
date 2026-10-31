import { Link } from 'react-router-dom';
import { ScheduledTaskList, useScheduledTasks } from '../../components/ScheduledTask';

export function ScheduledTasksPage() {
  const { tasks, loading, error, pause, resume, run } = useScheduledTasks();
  return <div className="mx-auto max-w-5xl p-6">
    <header className="mb-6 flex items-center justify-between">
      <div><h1 className="text-2xl font-semibold text-text-primary">定时任务</h1><p className="mt-1 text-sm text-text-secondary">让完整 Agent 按计划在新对话或已有对话中运行。</p></div>
      <Link to="/scheduled/new" className="rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600">创建任务</Link>
    </header>
    {error ? <p className="mb-4 text-sm text-red-500">{error}</p> : null}
    {loading ? <p className="text-sm text-text-secondary">加载中…</p> : <ScheduledTaskList tasks={tasks} onPause={pause} onResume={resume} onRun={run} />}
  </div>;
}
