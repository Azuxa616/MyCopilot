import { useState, useCallback } from 'react';
import type { AttachmentMeta } from '@my-copilot/shared';

/**
 * Local attachment with File reference for multipart upload
 */
interface LocalAttachment extends AttachmentMeta {
  /** Original File object for upload */
  file: File;
}

/**
 * Attachment management hook
 * Phase 1: local-only attachment handling (no server upload yet)
 * Files are stored locally and passed directly to sendMessage as File[]
 */
export function useAttachments() {
    const [attachments, setAttachments] = useState<LocalAttachment[]>([]);

    const addAttachment = useCallback((file: File) => {
        const attachment: LocalAttachment = {
            id: `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            name: file.name,
            type: file.type || 'application/octet-stream',
            size: file.size,
            file,
        };
        setAttachments((prev) => [...prev, attachment]);
    }, []);

    const removeAttachment = useCallback((attachmentId: string) => {
        setAttachments((prev) => prev.filter((att) => att.id !== attachmentId));
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
