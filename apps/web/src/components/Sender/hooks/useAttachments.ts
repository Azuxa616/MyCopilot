import { useState, useCallback } from 'react';
import type { Asset, AttachmentMeta } from '@my-copilot/shared';
import { api } from '../../../api';

/**
 * 资产化本地附件（选择即上传）：
 * addAttachment 先插入 uploading 占位卡片，await api.uploadAsset 成功后
 * 回填 assetId / 真实 mime；失败移除占位并向上抛错（由调用方 toast）。
 */
export interface LocalAttachment extends AttachmentMeta {
    /** 上传成功后的资产引用（与 assetId 同源，携带 kind 等元数据）。 */
    asset?: Asset;
    /** 上传中标记。 */
    uploading?: boolean;
}

export function useAttachments() {
    const [attachments, setAttachments] = useState<LocalAttachment[]>([]);

    const addAttachment = useCallback(async (file: File): Promise<void> => {
        const tempId = `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        setAttachments((prev) => [
            ...prev,
            {
                id: tempId,
                name: file.name,
                type: file.type || 'application/octet-stream',
                size: file.size,
                uploading: true,
            },
        ]);
        try {
            const asset = await api.uploadAsset(file);
            setAttachments((prev) =>
                prev.map((att) =>
                    att.id === tempId
                        ? { ...att, assetId: asset.id, type: asset.mimeType, uploading: false, asset }
                        : att,
                ),
            );
        } catch (err) {
            setAttachments((prev) => prev.filter((att) => att.id !== tempId));
            throw err;
        }
    }, []);

    const removeAttachment = useCallback((attachmentId: string) => {
        setAttachments((prev) => prev.filter((att) => att.id !== attachmentId && att.assetId !== attachmentId));
    }, []);

    const clearAttachments = useCallback(() => {
        setAttachments([]);
    }, []);

    return {
        attachments,
        addAttachment,
        removeAttachment,
        clearAttachments,
    };
}
