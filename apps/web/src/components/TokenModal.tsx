// TokenModal - Auth token input modal
// Shown when no auth token is set or when 401 is received

import { useState } from 'react'
import Modal from './common/Modal'
import { formControlClassName } from './common/FormField'
import { useConfigStore } from '../store/configStore'

export interface TokenModalProps {
  open: boolean;
  onSubmit: (token: string) => void;
}

export default function TokenModal({ open, onSubmit }: TokenModalProps) {
  const [token, setToken] = useState('');
  const tokenError = useConfigStore((state) => state.tokenError);

  const handleSubmit = () => {
    const trimmed = token.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setToken('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={() => {}}
      title="请输入访问令牌"
      showClose={false}
      maskClosable={false}
      width="400px"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">
          请从 server 启动日志获取 AUTH_TOKEN，粘贴到下方
        </p>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-text-secondary">API Token</label>
          <input
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={handleKeyDown}
            className={`${formControlClassName} font-mono`}
            placeholder="Enter your API token"
            autoFocus
          />
        </div>
        {tokenError && (
          <p className="text-sm text-error-500">{tokenError}</p>
        )}
        <button
          onClick={handleSubmit}
          disabled={!token.trim()}
          className="w-full px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          提交
        </button>
      </div>
    </Modal>
  )
}
