import IconDelete from '../../assets/icon/delete.svg?react';
import type { Attachment } from '../../types/chat';
import { formatFileSize, getFileTypeDisplay } from '../../utils/file';

interface AttachmentCardProps {
    attachment: Attachment;
    onRemove?: (attachmentId: string) => void;
}

export default function AttachmentCard({ attachment, onRemove }: AttachmentCardProps) {
    return (
        <div className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary rounded-lg border border-border-base hover:bg-bg-secondary transition-colors group">
            <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="shrink-0 w-8 h-8 flex items-center justify-center bg-primary-500/10 rounded text-primary-500 text-xs font-medium">
                    {getFileTypeDisplay(attachment.type, attachment.name)}
                </div>
                <div className="flex-1 min-w-0 flex flex-col">
                    <span className="text-sm text-text-primary truncate font-medium" title={attachment.name}>
                        {attachment.name}
                    </span>
                    <span className="text-xs text-text-tertiary">
                        {formatFileSize(attachment.size)}
                    </span>
                </div>
            </div>
            {onRemove && <button
                onClick={() => onRemove(attachment.id)}
                className="shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-error-500/10 text-text-tertiary hover:text-error-500 transition-colors opacity-0 group-hover:opacity-100"
                title="删除附件"
            >
                <IconDelete className="w-4 h-4" />
            </button>}
        </div>
    );
}


