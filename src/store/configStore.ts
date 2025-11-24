import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';


interface ConfigStore {
    apiMode: "mock" | "real";
    openaiConfig?: {
        apiKey: string;
        baseUrl: string;
        model: string;
    }; 
    setApiMode: (apiMode: "mock" | "real") => void;
    setOpenaiConfig: (openaiConfig: {
        apiKey: string;
        baseUrl: string;
        model: string;
    }) => void;
}


export const useConfigStore = create<ConfigStore>()(
    //持久化配置
    persist(
        (set) => ({
            apiMode: "mock",
            openaiConfig: undefined,
            setApiMode: (apiMode: "mock" | "real") => set({ apiMode }),
            setOpenaiConfig: (openaiConfig: {
                apiKey: string;
                baseUrl: string;
                model: string;
            }) => set({ openaiConfig }),
        }),
        {
            name: 'my-copilot-config',
            storage: createJSONStorage(() => localStorage),
        }
    )
);