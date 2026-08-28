// Zustand - Run trace（执行轨迹）状态管理
// 按会话缓存 runs 列表；run 的 steps 惰性加载。数据可随时重取，不持久化 localStorage。
import { create } from 'zustand';
import { api, type RunTraceDetail, type RunTraceWithStepCount } from '../api';

interface TraceStore {
    runsBySession: Record<string, RunTraceWithStepCount[]>;
    detailByRun: Record<string, RunTraceDetail>;
    isLoadingRuns: boolean;
    isLoadingRunDetail: boolean;
    error: string | null;

    fetchRuns: (sessionId: string) => Promise<void>;
    /** 惰性加载单条 Run 及其 steps；已缓存时直接返回，失败返回 null 并置 error。 */
    getRun: (runId: string) => Promise<RunTraceDetail | null>;
}

function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export const useTraceStore = create<TraceStore>()((set, get) => ({
    runsBySession: {},
    detailByRun: {},
    isLoadingRuns: false,
    isLoadingRunDetail: false,
    error: null,

    fetchRuns: async (sessionId) => {
        set({ isLoadingRuns: true, error: null });
        try {
            const runs = await api.fetchSessionRuns(sessionId);
            set((state) => ({
                runsBySession: { ...state.runsBySession, [sessionId]: runs },
                isLoadingRuns: false,
            }));
        } catch (error) {
            console.error('Failed to fetch session runs:', error);
            set({ error: toErrorMessage(error), isLoadingRuns: false });
        }
    },

    getRun: async (runId) => {
        const cached = get().detailByRun[runId];
        if (cached) {
            return cached;
        }

        set({ isLoadingRunDetail: true, error: null });
        try {
            const detail = await api.fetchRunDetail(runId);
            set((state) => ({
                detailByRun: { ...state.detailByRun, [runId]: detail },
                isLoadingRunDetail: false,
            }));
            return detail;
        } catch (error) {
            console.error('Failed to fetch run detail:', error);
            set({ error: toErrorMessage(error), isLoadingRunDetail: false });
            return null;
        }
    },
}));
