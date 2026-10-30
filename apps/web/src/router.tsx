import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Layout } from './views/Layout';
import { MainView } from './views/MainView';
import { SettingsShell } from './views/settings/SettingsShell';
import { ProvidersPage } from './views/settings/ProvidersPage';
import { ProviderDetailPage } from './views/settings/ProviderDetailPage';
import { ToolsPage } from './views/settings/ToolsPage';
import { SkillsPage } from './views/settings/SkillsPage';
import { McpsPage } from './views/settings/McpsPage';
import { PluginsPage } from './views/settings/PluginsPage';
import { ScheduledTasksPage } from './views/scheduled/ScheduledTasksPage';
import { ScheduledTaskEditorPage } from './views/scheduled/ScheduledTaskEditorPage';
import { ScheduledTaskDetailPage } from './views/scheduled/ScheduledTaskDetailPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <MainView /> },
      { path: 'scheduled', element: <ScheduledTasksPage /> },
      { path: 'scheduled/new', element: <ScheduledTaskEditorPage /> },
      { path: 'scheduled/:id', element: <ScheduledTaskDetailPage /> },
      { path: 'scheduled/:id/edit', element: <ScheduledTaskEditorPage /> },
    ],
  },
  {
    path: '/settings',
    element: <SettingsShell />,
    children: [
      // 直访 /settings 重定向到首个分类，保证「点设置必见内容」。
      { index: true, element: <Navigate to="/settings/providers" replace /> },
      { path: 'providers', element: <ProvidersPage /> },
      { path: 'providers/:id', element: <ProviderDetailPage /> },
      { path: 'tools', element: <ToolsPage /> },
      { path: 'skills', element: <SkillsPage /> },
      { path: 'mcps', element: <McpsPage /> },
      { path: 'plugins', element: <PluginsPage /> },
    ],
  },
]);
