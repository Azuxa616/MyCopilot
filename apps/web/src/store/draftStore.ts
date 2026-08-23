import { create } from 'zustand';

/**
 * 非持久化草稿 store：跨页面一次性文本交接（设置页 → 聊天输入框）。
 * AI 生成 skill 入口用：设置页写入提示词草稿 → 跳转会话 → Sender 消费。
 */
interface DraftStore {
  pendingDraft: string | null;
  setPendingDraft: (text: string) => void;
  consumePendingDraft: () => string | null;
}

export const useDraftStore = create<DraftStore>((set, get) => ({
  pendingDraft: null,
  setPendingDraft: (text) => set({ pendingDraft: text }),
  consumePendingDraft: (): string | null => {
    const d = get().pendingDraft;
    if (d !== null) set({ pendingDraft: null });
    return d;
  },
}));