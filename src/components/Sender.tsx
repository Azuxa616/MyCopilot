import { useRef, useEffect, useState } from 'react';
import IconAttachement from '../assets/icon/attachment.svg?react';
import IconSender from '../assets/icon/sender.svg?react';
import IconGenerating from '../assets/icon/generating.svg?react';
import { useChatStore } from '../store/chatStore';

export default function Sender() {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [content, setContent] = useState('');
    const { selectedChatId, sendMessage, createChat, isSending, cancelStream } = useChatStore();

    const adjustTextareaHeight = () => {
        const textarea = textareaRef.current;
        if (textarea) {
            // 获取当前高度
            const currentHeight = textarea.offsetHeight;
            
            // 临时设置为 auto 以获取准确的 scrollHeight
            textarea.style.height = 'auto';
            const scrollHeight = textarea.scrollHeight;
            const maxHeight = 200; // 最大高度 200px，约 8-9 行
            const newHeight = Math.min(scrollHeight, maxHeight);
            
            // 如果高度发生变化，使用 requestAnimationFrame 确保过渡动画生效
            if (Math.abs(currentHeight - newHeight) > 1) {
                // 先恢复当前高度，确保过渡从具体值开始
                textarea.style.height = `${currentHeight}px`;
                
                // 在下一帧设置新高度，让浏览器应用过渡动画
                requestAnimationFrame(() => {
                    if (textarea) {
                        textarea.style.height = `${newHeight}px`;
                        textarea.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
                    }
                });
            } else {
                // 高度变化很小，直接设置
                textarea.style.height = `${newHeight}px`;
                textarea.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
            }
        }
    };

    useEffect(() => {
        adjustTextareaHeight();
    }, []);

    useEffect(() => {
        adjustTextareaHeight();
    }, [content]);

    const handleSend = async () => {
        const trimmedContent = content.trim();
        if (!trimmedContent || isSending) {
            return;
        }

        let chatId = selectedChatId;
        
        // 如果没有选中的聊天，创建一个新聊天
        if (!chatId) {
            const newChat = createChat({ initialMessage: trimmedContent });
            chatId = newChat.id;
            useChatStore.getState().setSelectedChatId(chatId);
        } else {
            // 发送消息
            await sendMessage({
                chatId,
                content: trimmedContent,
            });
        }

        // 清空输入框
        setContent('');
        if (textareaRef.current) {
            textareaRef.current.value = '';
            textareaRef.current.style.height = 'auto';
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Enter 键发送，Shift+Enter 换行
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
        // Shift+Enter 允许默认行为（换行）
    };

    const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setContent(e.target.value);
        adjustTextareaHeight();
    };

    return (
        <div className="flex min-w-4xl items-end justify-between border border-border-base rounded-2xl px-4 py-3 bg-bg-elevated shadow-sm">
            <div className="flex items-end gap-2 flex-1">
                <button title="上传文件" className="w-9 h-9 text-primary-500 rounded-full hover:bg-primary-500 hover:text-white transition-colors group flex items-center justify-center shrink-0 mb-1">
                    <IconAttachement className="w-5 h-5 text-primary-500 group-hover:text-white transition-colors" />
                </button>

                <textarea
                    ref={textareaRef}
                    value={content}
                    onChange={handleInput}
                    onKeyDown={handleKeyDown}
                    className="flex-1 p-2 focus:outline-none bg-transparent text-text-primary placeholder:text-text-tertiary resize-none overflow-hidden min-h-[24px] max-h-[200px] transition-all duration-300"
                    placeholder="请输入消息"
                    rows={1}
                />
            </div>
            {isSending ? (
                <button 
                    title="中断生成" 
                    onClick={cancelStream}
                    className="px-4 py-2 bg-primary-500/20 text-primary-500 rounded-full hover:bg-primary-500/30 transition-colors trans font-medium shrink-0 ml-2 mb-1"
                >
                    <IconGenerating className="w-5 h-5 text-white transition-colors animate-spin" />
                </button>
            ) : (
                <button 
                    title="发送" 
                    onClick={handleSend}
                    disabled={!content.trim()}
                    className="px-4 py-2 bg-primary-500 text-white rounded-full hover:bg-primary-600 transition-colors font-medium shrink-0 ml-2 mb-1 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <IconSender className="w-5 h-5 text-white transition-colors" />
                </button>
            )}
        </div>
    )
}
