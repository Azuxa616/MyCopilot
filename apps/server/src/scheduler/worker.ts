import { dispatchDueScheduledTasks } from './dispatch.js';

const POLL_INTERVAL_MS = 1_000;
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function tick(): void {
  if (!running) return;
  try { dispatchDueScheduledTasks(); } catch (error) { console.error('[scheduler] poll failed:', error); }
  if (running) timer = setTimeout(tick, POLL_INTERVAL_MS);
}

export function startScheduler(): void {
  if (running) return;
  running = true;
  timer = setTimeout(tick, 0);
}

export function stopScheduler(): void {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
}
