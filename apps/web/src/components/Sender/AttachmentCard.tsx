// AttachmentCard - 附件卡片组件
// 显示附件信息（图片显示缩略图），支持删除操作

// Types
import type { AttachmentMeta } from '@my-copilot/shared'
// Hooks
import { useAssetUrl } from '../common/hooks/useAssetUrl'
// Utils
import { formatFileSize, getFileTypeDisplay } from '../../utils/file'
// Assets
import IconDelete from '../../assets/icon/delete.svg?react'

interface AttachmentCardProps {
    attachment: AttachmentMeta & { uploading?: boolean };
    onRemove?: (attachmentId: string) => void;
    /** 点击图片缩略图（预留内容栏打开）。 */
    onOpenAsset?: (assetId: string) => void;
}

export default function AttachmentCard({ attachment, onRemove, onOpenAsset }: AttachmentCardProps) {
    const isImage = attachment.type.startsWith('image/') && !!attachment.assetId;
    const imageUrl = useAssetUrl(isImage ? attachment.assetId : undefined);

    return (
        <div className={`flex items-center gap-2 px-3 py-2 bg-bg-tertiary rounded-lg border border-border-base hover:bg-bg-secondary transition-colors group ${attachment.uploading ? 'opacity-60' : ''}`}>
            <div className="flex items-center gap-2 flex-1 min-w-0">
                {isImage ? (
                    <button
                        type="button"
                        onClick={() => attachment.assetId && onOpenAsset?.(attachment.assetId)}
                        className="shrink-0 w-8 h-8 rounded overflow-hidden bg-bg-secondary"
                        title={attachment.uploading ? '上传中…' : '预览图片'}
                    >
                        {imageUrl ? (
                            <img src={imageUrl} alt={attachment.name} className="w-full h-full object-cover" />
                        ) : (
                            <span className="flex items-center justify-center w-full h-full text-[10px] text-text-tertiary animate-pulse">…</span>
                        )}
                    </button>
                ) : (
                    <div className="shrink-0 w-8 h-8 flex items-center justify-center bg-primary-500/10 rounded text-primary-500 text-xs font-medium">
                        {getFileTypeDisplay(attachment.type, attachment.name)}
                    </div>
                )}
                <div className="flex-1 min-w-0 flex flex-col">
                    <span className="text-sm text-text-primary truncate font-medium" title={attachment.name}>
                        {attachment.name}
                    </span>
                    <span className="text-xs text-text-tertiary">
                        {attachment.uploading ? '上传中…' : formatFileSize(attachment.size)}
                    </span>
                </div>
            </div>
            {onRemove && attachment.id && <button
                onClick={() => onRemove(attachment.id!)}
                className="shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-error-500/10 text-text-tertiary hover:text-error-500 transition-colors opacity-0 group-hover:opacity-100"
                title="删除附件"
            >
                <IconDelete className="w-4 h-4" />
            </button>}
        </div>
    );
}
