//ChatShell - 聊天界面
//包含消息发送框，以及对话内容展示区


//Components
import Sender from './Sender';
//Utils
import { getTimePeriod } from '../utils/time';
//Store
import { useUserStore } from '../store/userStore';

export default function ChatShell() {
    const { user } = useUserStore();
    return (
        <div className="flex flex-col h-full justify-center items-center gap-10 w-full max-w-4xl">
            <span className="text-3xl font-sans text-text-primary">
                {(getTimePeriod(Date.now())==="凌晨")?"夜深了":getTimePeriod(Date.now())}好，{user?.username ?? '用户'}，有什么可以帮你的吗？
            </span>
            <Sender />
        </div>
    );
}
