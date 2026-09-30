import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAssetUrl } from '../useAssetUrl';
import { fetchWithAuth } from '../../../../api';

vi.mock('../../../../api', () => ({
    fetchWithAuth: vi.fn(),
}));

// jsdom 无原生 createObjectURL：mock 之
const createObjectURL = vi.fn(() => 'blob:fake');
const revokeObjectURL = vi.fn();
URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;

function okResponse(): Response {
    return new Response(new Blob([new Uint8Array([0x89])]), { status: 200 });
}

describe('useAssetUrl', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('成功：blob → objectURL', async () => {
        vi.mocked(fetchWithAuth).mockResolvedValue(okResponse());
        const { result } = renderHook(() => useAssetUrl('a1'));
        await waitFor(() => expect(result.current).toBe('blob:fake'));
        expect(fetchWithAuth).toHaveBeenCalledWith('/api/assets/a1/raw', { method: 'GET' });
    });

    it('undefined assetId → undefined（不发请求）', () => {
        const { result } = renderHook(() => useAssetUrl(undefined));
        expect(result.current).toBeUndefined();
        expect(fetchWithAuth).not.toHaveBeenCalled();
    });

    it('非 2xx / 网络错误 → 保持 undefined（fail-soft）', async () => {
        vi.mocked(fetchWithAuth).mockResolvedValue(new Response('x', { status: 401 }));
        const { result } = renderHook(() => useAssetUrl('a1'));
        await waitFor(() => expect(fetchWithAuth).toHaveBeenCalled());
        expect(result.current).toBeUndefined();

        vi.mocked(fetchWithAuth).mockRejectedValue(new Error('network'));
        const { result: r2 } = renderHook(() => useAssetUrl('a2'));
        await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledTimes(2));
        expect(r2.current).toBeUndefined();
    });
});
