import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAttachments, type LocalAttachment } from '../useAttachments';
import { api } from '../../../../api';
import type { Asset } from '@my-copilot/shared';

vi.mock('../../../../api', () => ({
    api: {
        uploadAsset: vi.fn(),
    },
}));

function makeAsset(overrides: Partial<Asset> = {}): Asset {
    return {
        id: 'asset-1',
        name: 'a.png',
        mimeType: 'image/png',
        size: 8,
        kind: 'image',
        sha256: 'h',
        source: 'upload',
        createdAt: 1,
        updatedAt: 1,
        ...overrides,
    };
}

function makeFile(name = 'a.png', type = 'image/png'): File {
    return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type });
}

describe('useAttachments（选择即上传）', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('上传成功：占位卡片回填 assetId 与真实 mime', async () => {
        vi.mocked(api.uploadAsset).mockResolvedValue(makeAsset());

        const { result } = renderHook(() => useAttachments());
        await act(async () => {
            await result.current.addAttachment(makeFile());
        });

        expect(result.current.attachments).toHaveLength(1);
        const att: LocalAttachment = result.current.attachments[0]!;
        expect(att.assetId).toBe('asset-1');
        expect(att.type).toBe('image/png');
        expect(att.uploading).toBeFalsy();
    });

    it('上传中状态：占位先入列', async () => {
        let resolveUpload: (a: Asset) => void = () => {};
        vi.mocked(api.uploadAsset).mockImplementation(
            () => new Promise((resolve) => { resolveUpload = resolve; }),
        );

        const { result } = renderHook(() => useAttachments());
        let pending: Promise<void> | undefined;
        act(() => {
            pending = result.current.addAttachment(makeFile());
        });

        // 上传未完成：占位在列且 uploading
        expect(result.current.attachments).toHaveLength(1);
        expect(result.current.attachments[0]!.uploading).toBe(true);
        expect(result.current.attachments[0]!.assetId).toBeUndefined();

        await act(async () => {
            resolveUpload(makeAsset());
            await pending;
        });
        expect(result.current.attachments[0]!.assetId).toBe('asset-1');
    });

    it('上传失败：占位移除并抛错（由调用方 toast）', async () => {
        vi.mocked(api.uploadAsset).mockRejectedValue(new Error('上传失败（HTTP 413）'));

        const { result } = renderHook(() => useAttachments());
        await expect(act(async () => {
            await result.current.addAttachment(makeFile('big.png'));
        })).rejects.toThrow('413');

        await waitFor(() => {
            expect(result.current.attachments).toHaveLength(0);
        });
    });

    it('removeAttachment 支持 id 与 assetId 双键', async () => {
        vi.mocked(api.uploadAsset).mockResolvedValue(makeAsset());
        const { result } = renderHook(() => useAttachments());
        await act(async () => {
            await result.current.addAttachment(makeFile());
        });
        const id = result.current.attachments[0]!.id!;
        act(() => result.current.removeAttachment(id));
        expect(result.current.attachments).toHaveLength(0);

        await act(async () => {
            await result.current.addAttachment(makeFile());
        });
        act(() => result.current.removeAttachment('asset-1'));
        expect(result.current.attachments).toHaveLength(0);
    });
});
