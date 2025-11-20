import { useRef, useEffect } from 'react';
import IconAttachement from '../assets/icon/attachment.svg?react';
import IconSender from '../assets/icon/sender.svg?react';

export default function Sender() {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
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

    return (
        <div className="flex w-full min-w-60 items-end justify-between border border-border-base rounded-2xl px-4 py-3 bg-bg-elevated shadow-sm">
            <div className="flex items-end gap-2 flex-1">
                <button title="上传文件" className="w-9 h-9 text-primary-500 rounded-full hover:bg-primary-500 hover:text-white transition-colors group flex items-center justify-center shrink-0 mb-1">
                    <IconAttachement className="w-5 h-5 text-primary-500 group-hover:text-white transition-colors" />
                </button>
                <textarea
                    ref={textareaRef}
                    className="flex-1 p-2 focus:outline-none bg-transparent text-text-primary placeholder:text-text-tertiary resize-none overflow-hidden min-h-[24px] max-h-[200px] transition-all duration-300"
                    placeholder="请输入消息"
                    rows={1}
                    onInput={adjustTextareaHeight}
                />
            </div>
            <button title="发送" className="px-4 py-2 bg-primary-500 text-white rounded-full hover:bg-primary-600 transition-colors font-medium shrink-0 ml-2 mb-1">
                <IconSender className="w-5 h-5 text-white transition-colors" />
            </button>
        </div>
    )
}
