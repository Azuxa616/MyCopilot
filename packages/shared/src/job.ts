export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export type JobType = 'agent-loop';

export interface Job {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  leasedAt: number | null;
  leaseOwner: string | null;
  error: string | null;
  result: Record<string, unknown> | null;
  sessionId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateJobParams {
  type: JobType;
  payload: Record<string, unknown>;
  sessionId?: string;
  priority?: number;
  maxAttempts?: number;
}

export interface UpdateJobParams {
  status?: JobStatus;
  priority?: number;
  error?: string | null;
  result?: Record<string, unknown> | null;
}
