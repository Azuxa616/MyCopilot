import { useRef, useEffect, type RefObject } from 'react';

/**
 * Textarea 自动调整高度的 Hook
 * @param content 文本内容
 * @param maxHeight 最大高度（像素），默认 200px
 * @returns textarea 的 ref
 */
export function useTextareaAutoHeight(
    content: string,
    maxHeight: number = 200
): RefObject<HTMLTextAreaElement | null> {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const adjustTextareaHeight = () => {
            // 获取当前高度
            const currentHeight = textarea.offsetHeight;

            // 临时设置为 auto 以获取准确的 scrollHeight
            textarea.style.height = 'auto';
            const scrollHeight = textarea.scrollHeight;
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
        };

        adjustTextareaHeight();
    }, [content, maxHeight]);

    return textareaRef;
}

