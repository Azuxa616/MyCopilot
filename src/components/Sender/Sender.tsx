import { useState } from 'react';
import IconAttachement from '../../assets/icon/attachment.svg?react';
import IconSender from '../../assets/icon/sender.svg?react';
import IconGenerating from '../../assets/icon/generating.svg?react';
import { useChatStore } from '../../store/chatStore';
import AttachmentCard from './AttachmentCard';
import FileUploadModal from './FileUploadModal';
import { useTextareaAutoHeight } from './hooks/useTextareaAutoHeight';
import { useAttachments } from './hooks/useAttachments';
import { showMessageAlert } from '../common/Alert/alertUtils';

export default function Sender() {
    const [content, setContent] = useState('');
    const { selectedChatId, sendMessage, createChat, isSending, cancelStream } = useChatStore();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const textareaRef = useTextareaAutoHeight(content);
    const { attachments, handleUploadAttachment, handleRemoveAttachment, clearAttachments } = useAttachments();

    const handleSend = async () => {
        const trimmedContent = content.trim();
        if (!trimmedContent || isSending) {
            return;
        }

        let chatId = selectedChatId;

        // 如果没有选中的聊天，创建一个新聊天

        try{
            if (!chatId) {
                const newChat = createChat({ initialMessage: trimmedContent });
                chatId = newChat.id;
                useChatStore.getState().setSelectedChatId(chatId);
            } else {
                // 清空输入框
                setContent('');
                clearAttachments();
                if (textareaRef.current) {
                    textareaRef.current.value = '';
                    textareaRef.current.style.height = 'auto';
                }
                // 发送消息
                await sendMessage({
                    chatId,
                    content: trimmedContent,
                    attachments,
                });
            }
        }catch(error){
            console.error('发送消息失败:', error);
            showMessageAlert.error('发送消息失败');
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
    };

    return (
        <div className="flex flex-col min-w-4xl border border-border-base rounded-2xl bg-bg-elevated shadow-sm">
            {/* 附件列表 */}
            {attachments.length > 0 && (
                <div className="px-4 pt-3 pb-2 border-b border-border-base">
                    <div className="flex flex-wrap gap-2">
                        {attachments.map((attachment) => (
                            <AttachmentCard
                                key={attachment.id}
                                attachment={attachment}
                                onRemove={handleRemoveAttachment}
                            />
                        ))}
                    </div>
                </div>
            )}
            {/* 输入区域 */}
            <div className="flex items-end justify-between px-4 py-3">
                <div className="flex items-end gap-2 flex-1">
                    <button
                        title="上传文件"
                        onClick={() => setIsModalOpen(true)}
                        className="w-9 h-9 text-primary-500 rounded-full hover:bg-primary-500 hover:text-white transition-colors group flex items-center justify-center shrink-0 mb-1"
                    >
                        <IconAttachement className="w-5 h-5 text-primary-500 group-hover:text-white transition-colors" />
                    </button>
                    {/* 附件上传模态框 */}
                    <FileUploadModal
                        open={isModalOpen}
                        onOpenChange={setIsModalOpen}
                        attachments={attachments}
                        onUploadAttachment={handleUploadAttachment}
                        onRemoveAttachment={handleRemoveAttachment}
                    />
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
        </div>
    );
}
