import { createBrowserRouter } from 'react-router-dom';
import { Layout } from './views/Layout';
import { MainView } from './views/MainView';
import { SettingsLayout } from './views/settings/SettingsLayout';
import { ProvidersPage } from './views/settings/ProvidersPage';
import { ProviderDetailPage } from './views/settings/ProviderDetailPage';
import { ToolsPage } from './views/settings/ToolsPage';
import { SkillsPage } from './views/settings/SkillsPage';
import { McpsPage } from './views/settings/McpsPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <MainView /> },
      {
        path: 'settings',
        element: <SettingsLayout />,
        children: [
          { path: 'providers', element: <ProvidersPage /> },
          { path: 'providers/:id', element: <ProviderDetailPage /> },
          { path: 'tools', element: <ToolsPage /> },
          { path: 'skills', element: <SkillsPage /> },
          { path: 'mcps', element: <McpsPage /> },
        ],
      },
    ],
  },
]);
