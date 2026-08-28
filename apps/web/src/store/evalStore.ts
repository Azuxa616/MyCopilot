// Zustand - Eval（回归评估）状态管理
// 快照 / 场景列表 / 现场回放结果。数据可随时重取，不持久化 localStorage。
import { create } from 'zustand';
import type { EvalSnapshot } from '@my-copilot/shared';
import { api, type EvalReplayResult, type EvalScenarioMeta } from '../api';

interface EvalStore {
    snapshot: EvalSnapshot | null;
    scenarios: EvalScenarioMeta[];
    replayResult: EvalReplayResult | null;
    isLoadingSnapshot: boolean;
    isLoadingScenarios: boolean;
    isReplaying: boolean;
    error: string | null;

    fetchSnapshot: () => Promise<void>;
    fetchScenarios: () => Promise<void>;
    /** 现场确定性回放一个场景；失败置 error 且不清空已有 replayResult。 */
    replayScenario: (id: string) => Promise<void>;
}

function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export const useEvalStore = create<EvalStore>()((set) => ({
    snapshot: null,
    scenarios: [],
    replayResult: null,
    isLoadingSnapshot: false,
    isLoadingScenarios: false,
    isReplaying: false,
    error: null,

    fetchSnapshot: async () => {
        set({ isLoadingSnapshot: true, error: null });
        try {
            const snapshot = await api.fetchEvalSnapshot();
            set({ snapshot, isLoadingSnapshot: false });
        } catch (error) {
            console.error('Failed to fetch eval snapshot:', error);
            set({ error: toErrorMessage(error), isLoadingSnapshot: false });
        }
    },

    fetchScenarios: async () => {
        set({ isLoadingScenarios: true, error: null });
        try {
            const scenarios = await api.fetchEvalScenarios();
            set({ scenarios, isLoadingScenarios: false });
        } catch (error) {
            console.error('Failed to fetch eval scenarios:', error);
            set({ error: toErrorMessage(error), isLoadingScenarios: false });
        }
    },

    replayScenario: async (id) => {
        set({ isReplaying: true, error: null });
        try {
            const replayResult = await api.replayEvalScenario(id);
            set({ replayResult, isReplaying: false });
        } catch (error) {
            console.error('Failed to replay eval scenario:', error);
            set({ error: toErrorMessage(error), isReplaying: false });
        }
    },
}));
