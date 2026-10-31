import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScheduledTaskNavItem } from './ScheduledTaskNavItem';
import { api } from '../../api';

vi.mock('../../api', () => ({ api: { fetchScheduledTaskRunUnreadCount: vi.fn() } }));
describe('ScheduledTaskNavItem', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });
  it('展示定时任务入口和未读运行数', async () => {
    vi.mocked(api.fetchScheduledTaskRunUnreadCount).mockResolvedValue(3);
    render(<MemoryRouter><ScheduledTaskNavItem isCollapsed={false} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /定时任务/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('3')).toBeTruthy());
  });
});
