// 认证域 API：当前登录用户信息

import type { AuthInfo } from '@my-copilot/shared';
import { enhancedFetch } from '../request';

// ─── Auth APIs ───

export async function fetchAuthMe(): Promise<AuthInfo> {
    const response = await enhancedFetch<{ data: AuthInfo }>('/api/auth/me', {
        method: 'GET',
        timeout: 30000,
    });
    return response.data;
}
