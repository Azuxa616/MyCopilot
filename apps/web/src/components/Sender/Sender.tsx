// Sender - Message input component
// Contains input box, file upload, send button

import { useState } from 'react'
// Components
import AttachmentCard from './AttachmentCard'
import FileUploadModal from './FileUploadModal'
// Hooks
import { useTextareaAutoHeight } from './hooks/useTextareaAutoHeight'
import { useAttachments } from './hooks/useAttachments'
import { useModelOptions } from './hooks/useModelOptions'
// Store
import { useSessionStore, NEW_SESSION_SENTINEL } from '../../store/sessionStore'
import { useDraftStore } from '../../store/draftStore'
// Utils
import { showMessageAlert } from '../common/Alert/alertUtils'
import { isSupportedAttachmentName } from '../../utils/file'
import { getErrorMessage } from '../../api'
// Assets
import ModelSelector from './ModelSelector'
import IconAttachement from '../../assets/icon/attachment.svg?react'
import IconSender from '../../assets/icon/sender.svg?react'
import IconGenerating from '../../assets/icon/generating.svg?react'

export default function Sender() {
    const [content, setContent] = useState('');
    const { selectedSessionId, sendMessage, isSending, cancelStream, messagesCache, activeJobId } = useSessionStore();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const textareaRef = useTextareaAutoHeight(content);
    const { attachments, addAttachment, removeAttachment, clearAttachments } = useAttachments();
    const [prevSessionId, setPrevSessionId] = useState<string>('');

    // Get messages for current session
    const messages = selectedSessionId ? (messagesCache[selectedSessionId] || []) : [];

    // Reset sender state
    // textarea is controlled (value={content}) and useTextareaAutoHeight recomputes
    // height on content change, so resetting state alone fully resets the input.
    const resetSender = () => {
        setContent('');
        clearAttachments();
    };

    // Reset sender when switching to a new session.
    // Guarded render-time adjustment (react.dev "You Might Not Need an Effect").
    if (selectedSessionId !== prevSessionId) {
        setPrevSessionId(selectedSessionId);
        const isNewSession = !selectedSessionId || messages.length === 0;
        if (isNewSession) {
            resetSender();
        }
    }

    // 消费一次性草稿（设置页"让 AI 生成"入口写入）。仅当输入框为空时注入，避免覆盖用户输入。
    const pendingDraft = useDraftStore((s: { pendingDraft: string | null }) => s.pendingDraft);
    const [draftApplied, setDraftApplied] = useState(false);
    if (pendingDraft !== null && !draftApplied) {
        setDraftApplied(true);
        if (!content) setContent(pendingDraft);
        useDraftStore.getState().consumePendingDraft();
    }

    // 能力未知弱提示（学习闭环已收紧为"仅降级"——升格走设置页的答案验证探测或手动设置）
    const [visionHintDismissed, setVisionHintDismissed] = useState(false);
    const showVisionHint =
        !visionHintDismissed && attachments.some((a) => a.type.startsWith('image/'));

    // 统一的文件入口（模态框 / 粘贴 / 拖拽共用）：校验 → 选择即上传 → 失败 toast
    const addFiles = async (files: File[]) => {
        for (const file of files) {
            if (!isSupportedAttachmentName(file.name)) {
                showMessageAlert.warning('不支持该文件格式，仅支持 MD、TXT、CSV、DOCX、PDF 与图片');
                continue;
            }
            try {
                await addAttachment(file);
            } catch (error) {
                console.error('Failed to upload attachment:', error);
                showMessageAlert.error(`${file.name}: ${getErrorMessage(error)}`);
            }
        }
    };

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
        // 捕获当前附件（资产在选择时已上传），未完成上传的不进入本次消息
        const pending = attachments;
        const uploading = pending.filter((a) => a.uploading || !a.assetId);
        if (uploading.length > 0) {
            showMessageAlert.warning(`${uploading.length} 个附件仍在上传，本次消息将不包含它们`);
        }
        const ready = pending.filter((a) => a.assetId && !a.uploading);

        resetSender();

        try {
            // Send message via server SSE
            await sendMessage({
                sessionId: selectedSessionId,
                content: messageContent,
                assetIds: ready.length > 0 ? ready.map((a) => a.assetId!) : undefined,
                attachments: ready.map((a) => ({
                    assetId: a.assetId,
                    name: a.name,
                    type: a.type,
                    size: a.size,
                })),
            });
        } catch (error) {
            console.error('Failed to send message:', error);
            showMessageAlert.error(getErrorMessage(error));
        }
    };

    // 粘贴图片：剪贴板文件直接进入上传管道
    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const files = Array.from(e.clipboardData?.files ?? []);
        if (files.length > 0) {
            e.preventDefault();
            void addFiles(files);
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

    const { allModels, providersMap, isLoadingModels, effectiveModelId, handleModelChange } = useModelOptions();

    return (
        // 列宽容器：与消息区内容列保持同一最大宽度，输入框不再顶满两侧
        <div className="w-full max-w-3xl mx-auto px-4">
            <div
                className="flex flex-col w-full border border-border-base rounded-2xl bg-bg-elevated shadow-sm"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                    e.preventDefault();
                    void addFiles(Array.from(e.dataTransfer?.files ?? []));
                }}
            >
                {/* 能力未知弱提示（能力探测计划落地后接入三态判定） */}
                {showVisionHint && (
                    <div className="flex items-start justify-between gap-2 px-4 pt-3 text-xs text-text-tertiary">
                        <span>未确认当前模型支持图片输入，可在 设置 → 模型 中「测试图片输入」实测</span>
                        <button
                            type="button"
                            onClick={() => setVisionHintDismissed(true)}
                            className="shrink-0 text-text-tertiary hover:text-text-secondary"
                            title="知道了"
                        >
                            ✕
                        </button>
                    </div>
                )}
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
                <div className="px-3 pt-3">
                    <textarea
                        ref={textareaRef}
                        value={content}
                        onChange={handleInput}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                        className="w-full px-2 py-1 focus:outline-none bg-transparent text-text-primary placeholder:text-text-tertiary resize-none overflow-hidden min-h-[24px] max-h-[200px] transition-all duration-300"
                        placeholder={selectedSessionId ? 'Enter your message' : '请先创建新对话'}
                        rows={1}
                        disabled={!selectedSessionId}
                    />
                </div>
                {/* 底部工具行：附件 + 模型选择（左），发送/停止（右） */}
                <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
                    <div className="flex items-center gap-1 min-w-0">
                        <button
                            title="Upload file"
                            onClick={() => setIsModalOpen(true)}
                            className="w-9 h-9 text-primary-500 rounded-full hover:bg-primary-500 hover:text-white transition-colors group flex items-center justify-center shrink-0"
                        >
                            <IconAttachement className="w-5 h-5 text-primary-500 group-hover:text-white transition-colors" />
                        </button>
                        {/* File upload modal */}
                        <FileUploadModal
                            open={isModalOpen}
                            onOpenChange={setIsModalOpen}
                            attachments={attachments}
                            onFileSelect={(file) => { void addFiles([file]); }}
                            onRemoveAttachment={removeAttachment}
                        />
                        <ModelSelector
                            models={allModels}
                            providersMap={providersMap}
                            isLoading={isLoadingModels}
                            value={effectiveModelId}
                            onChange={(modelId) => { void handleModelChange(modelId); }}
                        />
                        {import.meta.env.DEV && currentSession?.id && (
                            <span className="text-[10px] text-text-tertiary font-mono shrink-0">
                                sid:{currentSession.id.slice(0, 8)}
                            </span>
                        )}
                    </div>
                    {isSending ? (
                        <button
                            title="Stop generating"
                            onClick={cancelStream}
                            className="px-4 py-2 bg-primary-500/20 text-primary-500 rounded-full hover:bg-primary-500/30 transition-colors trans font-medium shrink-0"
                        >
                            <IconGenerating className="w-5 h-5 text-white transition-colors animate-spin" />
                        </button>
                    ) : (
                        <button
                            title="Send"
                            onClick={handleSend}
                            disabled={!content.trim() || !selectedSessionId || isJobActive}
                            className="px-4 py-2 bg-primary-500 text-white rounded-full hover:bg-primary-600 transition-colors font-medium shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <IconSender className="w-5 h-5 text-white transition-colors" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
