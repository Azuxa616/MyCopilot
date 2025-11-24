import { useState, useCallback } from 'react';
import type { Attachment } from '../../../types/chat';
import { uploadAttachmentMock } from '../../../api/mock';
import { ApiStatusCode } from '../../../types/api';

/**
 * 附件管理的 Hook
 * @returns 附件列表和相关操作方法
 */
export function useAttachments() {
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    
    const handleUploadAttachment = useCallback(async (attachment: Attachment) => {
        const response = await uploadAttachmentMock(attachment);
        if (response.code === ApiStatusCode.SUCCESS) {
            setAttachments((prev) => [...prev, response.data]);
        }
    }, []);
    //处理删除附件
    const handleRemoveAttachment = useCallback((attachmentId: string) => {
        setAttachments((prev) => prev.filter((att) => att.id !== attachmentId));
    }, []);

    //清空附件
    const clearAttachments = useCallback(() => {
        setAttachments([]);
    }, []);

    return {
        attachments,
        handleUploadAttachment,
        handleRemoveAttachment,
        clearAttachments,
    };
}


