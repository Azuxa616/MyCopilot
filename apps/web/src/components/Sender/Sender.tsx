// Sender - Message input component
// Contains input box, file upload, send button

import { useState, useEffect, useRef, useCallback } from 'react'
// Components
import AttachmentCard from './AttachmentCard'
import FileUploadModal from './FileUploadModal'
// Hooks
import { useTextareaAutoHeight } from './hooks/useTextareaAutoHeight'
import { useAttachments } from './hooks/useAttachments'
// Store
import { useSessionStore, NEW_SESSION_SENTINEL } from '../../store/sessionStore'
// Utils
import { showMessageAlert } from '../common/Alert/alertUtils'
// Assets
import IconAttachement from '../../assets/icon/attachment.svg?react'
import IconSender from '../../assets/icon/sender.svg?react'
import IconGenerating from '../../assets/icon/generating.svg?react'

export default function Sender() {
    const [content, setContent] = useState('');
    const { selectedSessionId, sendMessage, isSending, cancelStream, messagesCache, activeJobId } = useSessionStore();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const textareaRef = useTextareaAutoHeight(content);
    const { attachments, addAttachment, removeAttachment, clearAttachments } = useAttachments();
    const prevSessionIdRef = useRef<string>('');

    // Get messages for current session
    const messages = selectedSessionId ? (messagesCache[selectedSessionId] || []) : [];

    // Reset sender state
    const resetSender = useCallback(() => {
        setContent('');
        clearAttachments();
        if (textareaRef.current) {
            textareaRef.current.value = '';
            textareaRef.current.style.height = 'auto';
        }
    }, [clearAttachments]);

    // Reset sender when switching to a new session
    useEffect(() => {
        if (selectedSessionId && selectedSessionId !== prevSessionIdRef.current) {
            // Check if it's a new session (no messages)
            const isNewSession = messages.length === 0;

            if (isNewSession) {
                resetSender();
            }

            prevSessionIdRef.current = selectedSessionId;
        } else if (!selectedSessionId) {
            resetSender();
            prevSessionIdRef.current = '';
        }
    }, [selectedSessionId, messages.length, resetSender]);

    const currentSession = useSessionStore((state) => state.currentSession);
    const pendingModelId = useSessionStore((state) => state.pendingModelId);

    const hasModel = selectedSessionId === NEW_SESSION_SENTINEL
        ? !!pendingModelId
        : !!currentSession?.modelId;

    // A background job is in flight (async send mode) — block sending until it settles.
    const isJobActive = !!activeJobId;

    const handleSend = async () => {
        const trimmedContent = content.trim();
        if (!trimmedContent || isSending || isJobActive) {
            return;
        }

        if (!selectedSessionId) {
            showMessageAlert.warning('请先创建新对话');
            return;
        }

        if (!hasModel) {
            showMessageAlert.warning('请先选择模型');
            return;
        }

        const messageContent = trimmedContent;
        const messageFiles: File[] = attachments.map(a => a.file);

        // Clear input and attachments
        resetSender();

        try {
            // Send message via server SSE
            await sendMessage({
                sessionId: selectedSessionId,
                content: messageContent,
                files: messageFiles.length > 0 ? messageFiles : undefined,
            });
        } catch (error) {
            console.error('Failed to send message:', error);
            showMessageAlert.error('Failed to send message');
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Enter to send, Shift+Enter for newline
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setContent(e.target.value);
    };

    return (
        <div className="flex flex-col w-full min-w-sm border border-border-base rounded-2xl bg-bg-elevated shadow-sm">
            {/* Attachment list */}
            {attachments.length > 0 && (
                <div className="px-4 pt-3 pb-2 border-b border-border-base">
                    <div className="flex flex-wrap gap-2">
                        {attachments.map((attachment) => (
                            <AttachmentCard
                                key={attachment.id}
                                attachment={attachment}
                                onRemove={removeAttachment}
                            />
                        ))}
                    </div>
                </div>
            )}
            {/* Input area */}
            <div className="flex items-end justify-between px-4 py-3">
                <div className="flex items-end gap-2 flex-1">
                    <button
                        title="Upload file"
                        onClick={() => setIsModalOpen(true)}
                        className="w-9 h-9 text-primary-500 rounded-full hover:bg-primary-500 hover:text-white transition-colors group flex items-center justify-center shrink-0 mb-1"
                    >
                        <IconAttachement className="w-5 h-5 text-primary-500 group-hover:text-white transition-colors" />
                    </button>
                    {/* File upload modal */}
                    <FileUploadModal
                        open={isModalOpen}
                        onOpenChange={setIsModalOpen}
                        attachments={attachments}
                        onFileSelect={addAttachment}
                        onRemoveAttachment={removeAttachment}
                    />
                    <textarea
                        ref={textareaRef}
                        value={content}
                        onChange={handleInput}
                        onKeyDown={handleKeyDown}
                        className="flex-1 p-2 focus:outline-none bg-transparent text-text-primary placeholder:text-text-tertiary resize-none overflow-hidden min-h-[24px] max-h-[200px] transition-all duration-300"
                        placeholder={selectedSessionId ? 'Enter your message' : '请先创建新对话'}
                        rows={1}
                        disabled={!selectedSessionId}
                    />
                </div>
                {isSending ? (
                    <button
                        title="Stop generating"
                        onClick={cancelStream}
                        className="px-4 py-2 bg-primary-500/20 text-primary-500 rounded-full hover:bg-primary-500/30 transition-colors trans font-medium shrink-0 ml-2 mb-1"
                    >
                        <IconGenerating className="w-5 h-5 text-white transition-colors animate-spin" />
                    </button>
                ) : (
                    <button
                        title="Send"
                        onClick={handleSend}
                        disabled={!content.trim() || !selectedSessionId || isJobActive}
                        className="px-4 py-2 bg-primary-500 text-white rounded-full hover:bg-primary-600 transition-colors font-medium shrink-0 ml-2 mb-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <IconSender className="w-5 h-5 text-white transition-colors" />
                    </button>
                )}
            </div>
        </div>
    );
}
