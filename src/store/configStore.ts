import { create } from 'zustand';



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
    (set) => ({
        apiMode: "mock",
        openaiConfig: undefined,
        setApiMode: (apiMode: "mock" | "real") => set({ apiMode }),
        setOpenaiConfig: (openaiConfig: {
            apiKey: string;
            baseUrl: string;
            model: string;
        }) => set({ openaiConfig }),
    })
);