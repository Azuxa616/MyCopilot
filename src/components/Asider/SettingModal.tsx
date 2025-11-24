import { useState, useEffect } from "react";
import Modal from '../common/Modal';
import Avatar from '../common/Avatar';
import Switch from '../common/Switch';
import { useUserStore } from '../../store/userStore';
import { useConfigStore } from '../../store/configStore';

export interface SettingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SettingModal({ open, onOpenChange }: SettingModalProps) {
  const user = useUserStore((state) => state.user);
  const updateUser = useUserStore((state) => state.updateUser);
  const apiMode = useConfigStore((state) => state.apiMode);
  const openaiConfig = useConfigStore((state) => state.openaiConfig);
  const setApiMode = useConfigStore((state) => state.setApiMode);
  const setOpenaiConfig = useConfigStore((state) => state.setOpenaiConfig);

  // 表单状态（本地状态）
  const [formData, setFormData] = useState({
    username: user?.username || '',
    email: user?.email || '',
    avatarUrl: user?.avatarUrl || '',
    apiKey: openaiConfig?.apiKey || '',
    baseUrl: openaiConfig?.baseUrl || '',
    model: openaiConfig?.model || '',
    apiMode: apiMode, // 本地 API 模式状态
  });

  // 当模态框打开时，重置表单数据为 store 中的当前值
  useEffect(() => {
    if (open) {
      setFormData({
        username: user?.username || '',
        email: user?.email || '',
        avatarUrl: user?.avatarUrl || '',
        apiKey: openaiConfig?.apiKey || '',
        baseUrl: openaiConfig?.baseUrl || '',
        model: openaiConfig?.model || '',
        apiMode: apiMode,
      });
    }
  }, [open, user, openaiConfig, apiMode]);

  // 处理用户信息更新（仅更新本地状态）
  const handleUserInfoChange = (field: 'username' | 'email' | 'avatarUrl', value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // 处理 API 配置更新（仅更新本地状态）
  const handleApiConfigChange = (field: 'apiKey' | 'baseUrl' | 'model', value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // 处理 API 模式切换（仅更新本地状态）
  const handleApiModeChange = (isReal: boolean) => {
    setFormData(prev => ({ ...prev, apiMode: isReal ? 'real' : 'mock' }));
  };

  // 处理保存按钮点击
  const handleSave = () => {
    // 更新用户信息
    updateUser({
      username: formData.username,
      email: formData.email,
      avatarUrl: formData.avatarUrl,
    });

    // 更新 API 模式
    setApiMode(formData.apiMode);

    // 更新 API 配置（仅在真实模式下保存）
    if (formData.apiMode === 'real') {
      setOpenaiConfig({
        apiKey: formData.apiKey,
        baseUrl: formData.baseUrl,
        model: formData.model,
      });
    }

    // 关闭模态框
    onOpenChange(false);
  };

  const isRealMode = formData.apiMode === 'real';

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="设置"
    >
      <div className="flex flex-col gap-6">
        {/* 用户信息区 */}
        <div className="flex flex-col gap-4 ">
          <h3 className=" font-semibold text-text-primary border-b border-border-base pb-2">
            用户信息
          </h3>
          <div className="flex items-start gap-4">
            {/* 头像区 */}
            <div className="shrink-0">
              <Avatar src={formData.avatarUrl} alt="avatar" size={12} className="shrink-0" />
            </div>
            {/* 用户信息输入区 */}
            <div className="flex-1 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-text-secondary">用户名</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => handleUserInfoChange('username', e.target.value)}
                  className="w-full px-3 py-2 text-sm text-text-primary bg-bg-elevated border border-border-base rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all placeholder:text-text-tertiary"
                  placeholder="请输入用户名"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-text-secondary">邮箱</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleUserInfoChange('email', e.target.value)}
                  className="w-full px-3 py-2 text-sm text-text-primary bg-bg-elevated border border-border-base rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all placeholder:text-text-tertiary"
                  placeholder="请输入邮箱"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-text-secondary">头像链接</label>
                <input
                  type="url"
                  value={formData.avatarUrl}
                  onChange={(e) => handleUserInfoChange('avatarUrl', e.target.value)}
                  className="w-full px-3 py-2 text-xs text-text-secondary bg-bg-elevated border border-border-base rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all placeholder:text-text-tertiary"
                  placeholder="请输入头像 URL"
                />
              </div>
            </div>
          </div>
        </div>

        {/* API 配置区 */}
        <div className="flex flex-col gap-4">
          <h3 className="text-base font-semibold text-text-primary border-b border-border-base pb-2">
            API 配置
          </h3>
          <div className="flex flex-col gap-4">
            {/* API 模式切换 */}
            <div className="flex items-center justify-between p-3 bg-bg-tertiary rounded-lg border border-border-base">
              <div className="flex items-center gap-0.5">
                <span className="text-sm font-medium text-text-primary">当前API 模式：</span>
                <span className={`text-sm ${isRealMode ? 'text-success' : 'text-info'}`}>
                  {isRealMode ? '真实 API 模式' : 'Mock 模式'}
                </span>
              </div>
              <Switch
                value={isRealMode}
                onValueChange={handleApiModeChange}
              />
            </div>

            {/* API 配置输入区 */}
            {isRealMode && (
              <div className="flex flex-col gap-3 p-4 bg-bg-secondary rounded-lg border border-border-base">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-text-secondary">API Key</label>
                  <input
                    type="password"
                    value={formData.apiKey}
                    onChange={(e) => handleApiConfigChange('apiKey', e.target.value)}
                    className="w-full px-3 py-2 text-sm text-text-primary bg-bg-elevated border border-border-base rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all placeholder:text-text-tertiary font-mono"
                    placeholder="请输入 API Key"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-text-secondary">Base URL</label>
                  <input
                    type="url"
                    value={formData.baseUrl}
                    onChange={(e) => handleApiConfigChange('baseUrl', e.target.value)}
                    className="w-full px-3 py-2 text-sm text-text-primary bg-bg-elevated border border-border-base rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all placeholder:text-text-tertiary"
                    placeholder="https://api.openai.com/v1"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-text-secondary">Model</label>
                  <input
                    type="text"
                    value={formData.model}
                    onChange={(e) => handleApiConfigChange('model', e.target.value)}
                    className="w-full px-3 py-2 text-sm text-text-primary bg-bg-elevated border border-border-base rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all placeholder:text-text-tertiary"
                    placeholder="gpt-3.5-turbo"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex justify-end gap-3 pt-2 border-t border-border-base">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 bg-bg-tertiary text-text-primary rounded-lg hover:bg-bg-hover transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-success text-white rounded-lg hover:bg-success-dark transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </Modal>
  )
}

