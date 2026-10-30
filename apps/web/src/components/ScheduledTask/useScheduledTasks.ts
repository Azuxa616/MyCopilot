import { useCallback, useEffect, useState } from 'react';
import type { ScheduledTask } from '@my-copilot/shared';
import { api } from '../../api';

export function useScheduledTasks() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setTasks(await api.fetchScheduledTasks()); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const act = useCallback(async (operation: () => Promise<unknown>) => { await operation(); await refresh(); }, [refresh]);
  return {
    tasks, loading, error, refresh,
    pause: (id: string) => act(() => api.pauseScheduledTask(id)),
    resume: (id: string) => act(() => api.resumeScheduledTask(id)),
    run: (id: string) => act(() => api.runScheduledTaskNow(id)),
    remove: (id: string) => act(() => api.deleteScheduledTask(id)),
  };
}
