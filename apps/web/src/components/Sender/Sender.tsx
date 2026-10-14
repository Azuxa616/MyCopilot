// Sender - Message input component
// Contains input box, file upload, send button

import { useEffect, useMemo, useState } from 'react'
// Components
import AttachmentCard from './AttachmentCard'
import FileUploadModal from './FileUploadModal'
import CommandPalette from './CommandPalette'
import ReferencePicker from './ReferencePicker'
import ChipsOverlay from './ChipsOverlay'
import ReferenceChip from './ReferenceChip'
// Hooks
import { useTextareaAutoHeight } from './hooks/useTextareaAutoHeight'
import { useAttachments } from './hooks/useAttachments'
import { useChipInput } from './hooks/useChipInput'
import type { CommandEntry, ReferenceCandidate, SerializedDraft } from './chips/model'
// Store
import { useSessionStore, NEW_SESSION_SENTINEL } from '../../store/sessionStore'
import { useDraftStore } from '../../store/draftStore'
// Utils
import { showMessageAlert } from '../common/Alert/alertUtils'
import { isSupportedAttachmentName } from '../../utils/file'
import { api, getErrorMessage } from '../../api'
// Assets
import IconAttachement from '../../assets/icon/attachment.svg?react'
import IconSender from '../../assets/icon/sender.svg?react'
import IconGenerating from '../../assets/icon/generating.svg?react'

export default function Sender() {
    const { selectedSessionId, sendMessage, isSending, cancelStream, messagesCache, activeJobId } = useSessionStore();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const { attachments, addAttachment, removeAttachment, clearAttachments } = useAttachments();
    const [prevSessionId, setPrevSessionId] = useState<string>('');

    // Get messages for current session
    const messages = selectedSessionId ? (messagesCache[selectedSessionId] || []) : [];

    // / 命令候选：skill 有效集（GET /api/skills/effective，与 buildSkillInjections 同源）
    const [skillEntries, setSkillEntries] = useState<CommandEntry[]>([])
    useEffect(() => {
        let active = true
        api.fetchEffectiveSkills()
            .then((metas) => {
                if (active) {
                    setSkillEntries(
                        metas.map((m) => ({
                            id: m.id,
                            label: m.name,
                            description: m.description,
                            triggers: m.triggers,
                            kind: 'skill' as const,
                        })),
                    )
                }
            })
            .catch(() => {
                if (active) setSkillEntries([])
            })
        return () => {
            active = false
        }
    }, [])

    // @file 候选：资产列表（plan A 端点 GET /api/assets）
    interface AssetListItem { id: string; name: string; size: number }
    const [assets, setAssets] = useState<AssetListItem[]>([])
    useEffect(() => {
        let active = true
        api.fetchAssets()
            .then((list) => {
                if (active) setAssets(list)
            })
            .catch(() => {})
        return () => {
            active = false
        }
    }, [])

    // @ 引用候选：资产（文件名）在前、会话（标题，排除当前会话）在后
    const sessionSummaries = useSessionStore((s) => s.sessionSummaries)
    const references = useMemo<ReferenceCandidate[]>(() => {
        const files: ReferenceCandidate[] = assets.map((a) => ({
            id: a.id,
            kind: 'file' as const,
            title: a.name,
            subtitle: `${Math.max(1, Math.round(a.size / 1024))} KB`,
            token: `@${a.name}`,
            assetId: a.id,
        }))
        const sessions: ReferenceCandidate[] = sessionSummaries
            .filter((s) => s.id !== selectedSessionId)
            .map((s) => ({
                id: s.id,
                kind: 'session' as const,
                title: s.title,
                subtitle: `${s.messageCount} 条消息`,
                token: `@${s.title}`,
                sessionId: s.id,
            }))
        return [...files, ...sessions]
    }, [assets, sessionSummaries, selectedSessionId])



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

    // chip 提交回调（useChipInput 的 onSend）：校验 → 组装载荷 → 发送。
    // 返回 true 后 hook 乐观清空文本与 chips；异步错误在此 toast。
    const handleChipSubmit = (draft: SerializedDraft): boolean => {
        if (isSending || isJobActive) {
            return false
        }
        if (!selectedSessionId) {
            showMessageAlert.warning('请先创建新对话');
            return false
        }
        if (!hasModel) {
            showMessageAlert.warning('请先选择模型');
            return false
        }

        // 捕获当前附件（资产在选择时已上传），未完成上传的不进入本次消息
        const pending = attachments;
        const uploading = pending.filter((a) => a.uploading || !a.assetId);
        if (uploading.length > 0) {
            showMessageAlert.warning(`${uploading.length} 个附件仍在上传，本次消息将不包含它们`);
        }
        const ready = pending.filter((a) => a.assetId && !a.uploading);
        clearAttachments();

        // assetIds = 上传附件 + @file chip 引用（plan A 管道统一解析）
        const assetIds = [...ready.map((a) => a.assetId!), ...draft.assetIds];

        void sendMessage({
            sessionId: selectedSessionId,
            content: draft.content,
            assetIds: assetIds.length > 0 ? assetIds : undefined,
            enforcedSkillIds: draft.enforcedSkillIds.length > 0 ? draft.enforcedSkillIds : undefined,
            referencedSessionIds: draft.referencedSessionIds.length > 0 ? draft.referencedSessionIds : undefined,
            attachments: ready.map((a) => ({
                assetId: a.assetId,
                name: a.name,
                type: a.type,
                size: a.size,
            })),
        }).catch((error) => {
            console.error('Failed to send message:', error);
            showMessageAlert.error(getErrorMessage(error));
        });
        return true
    };

    // chip 输入接线（顺序关键：handleChipSubmit 必须在 hook 之前定义——TDZ）
    const {
        content, chips, skillChips, trigger, candidates, draft,
        handleInput, handleKeyDown, selectItem, hoverItem, submit, reset, removeChip, setTextareaRef, setContent,
    } = useChipInput({ skills: skillEntries, references, onSend: handleChipSubmit })
    const textareaRef = useTextareaAutoHeight(content)

    // Reset sender state
    // textarea is controlled (value={content}) and useTextareaAutoHeight recomputes
    // height on content change, so resetting state alone fully resets the input.
    const resetSender = () => {
        reset();
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

    // 粘贴图片：剪贴板文件直接进入上传管道
    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const files = Array.from(e.clipboardData?.files ?? []);
        if (files.length > 0) {
            e.preventDefault();
            void addFiles(files);
        }
    };

    return (
        <div
            className="flex flex-col w-full min-w-sm border border-border-base rounded-2xl bg-bg-elevated shadow-sm"
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
            {/* @ 引用卡片行（会话/文件；不占用输入文本） */}
            {chips.some((chip) => chip.kind !== 'skill') && (
                <div className="px-4 pt-3 pb-2 border-b border-border-base">
                    <div className="flex flex-wrap gap-2">
                        {chips.filter((chip) => chip.kind !== 'skill').map((chip) => (
                            <ReferenceChip
                                key={chip.id}
                                chip={chip}
                                onRemove={removeChip}
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
                        onFileSelect={(file) => { void addFiles([file]); }}
                        onRemoveAttachment={removeAttachment}
                    />
                    <div className="relative flex-1 min-w-0">
                        <ChipsOverlay value={content} chips={skillChips} />
                        <textarea
                            ref={(el) => {
                                textareaRef.current = el
                                setTextareaRef(el)
                            }}
                            value={content}
                            onChange={handleInput}
                            onKeyDown={handleKeyDown}
                            onPaste={handlePaste}
                            className="block w-full p-2 text-base leading-6 focus:outline-none bg-transparent text-text-primary placeholder:text-text-tertiary resize-none overflow-hidden min-h-[24px] max-h-[200px] transition-all duration-300"
                            placeholder={selectedSessionId ? 'Enter your message（/ 命令 · @ 引用）' : '请先创建新对话'}
                            rows={1}
                            disabled={!selectedSessionId}
                        />
                        {trigger.open && trigger.kind === 'command' && (
                            <CommandPalette
                                items={candidates}
                                selectedIndex={trigger.selectedIndex}
                                query={trigger.query}
                                onSelect={selectItem}
                                onHover={hoverItem}
                            />
                        )}
                        {trigger.open && trigger.kind === 'reference' && (
                            <ReferencePicker
                                stage={trigger.stage}
                                items={candidates}
                                selectedIndex={trigger.selectedIndex}
                                query={trigger.query}
                                categoryLabel={
                                    trigger.stage === 'items'
                                        ? trigger.category === 'session' ? '会话' : '文件'
                                        : undefined
                                }
                                onSelect={selectItem}
                                onHover={hoverItem}
                            />
                        )}
                    </div>
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
                        onClick={submit}
                        disabled={!draft.content || !selectedSessionId || isJobActive}
                        className="px-4 py-2 bg-primary-500 text-white rounded-full hover:bg-primary-600 transition-colors font-medium shrink-0 ml-2 mb-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <IconSender className="w-5 h-5 text-white transition-colors" />
                    </button>
                )}
            </div>
        </div>
    );
}
