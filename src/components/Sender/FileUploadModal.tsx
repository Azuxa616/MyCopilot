// FileUploadModal - 文件上传模态框组件
// 提供文件上传界面，显示已上传的附件列表

// Types
import type { Attachment } from '../../types/chat'
// Components
import Modal from '../common/Modal'
import Uploader from '../common/Uploader'
import AttachmentCard from './AttachmentCard'

interface FileUploadModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    attachments: Attachment[];
    onUploadAttachment: (attachment: Attachment) => Promise<void>;
    onRemoveAttachment: (attachmentId: string) => void;
}

export default function FileUploadModal({
    open,
    onOpenChange,
    attachments,
    onUploadAttachment,
    onRemoveAttachment,
}: FileUploadModalProps) {
    const handleAttachmentReady = async (attachment: Attachment) => {
        await onUploadAttachment(attachment);
        // 上传成功后关闭模态框
        onOpenChange(false);
    };

    return (
        <Modal open={open} onOpenChange={onOpenChange} title="上传文件">
            <div className="flex flex-col gap-4 items-center justify-center py-4">
                <Uploader onAttachmentReady={handleAttachmentReady} />
                {attachments.length > 0 && (
                    <div className="w-full max-w-md">
                        <div className="text-sm text-text-secondary mb-2">已上传的附件：</div>
                        <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                            {attachments.map((attachment) => (
                                <AttachmentCard
                                    key={attachment.id}
                                    attachment={attachment}
                                    onRemove={onRemoveAttachment}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
}


