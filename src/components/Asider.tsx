import { useState } from "react";

//Components
import Popover from './common/Popover';
import Avatar from './common/Avatar';
//Icons
import IconCollapsedLeft from '../assets/icon/collapsed-left.svg?react';
import IconCollapsedRight from '../assets/icon/collapsed-right.svg?react';
import IconEllipsis from '../assets/icon/ellipsis.svg?react';
import IconPlus from '../assets/icon/plus.svg?react';
import IconDelete from '../assets/icon/delete.svg?react';
//Store
import { useChatStore } from '../store/chatStore';
import { useUserStore } from '../store/userStore';

interface UserInfoCardProps {
  username: string;
  email: string;
  avatarUrl: string;
  isCollapsed: boolean;
}

interface ConversationNavItemProps {
  id: string;
  title: string;
  isCollapsed: boolean;
  isSelected: boolean;
  onClick: () => void;
  onDelete: () => void;
}

const ConversationNavItem = ({ title, isCollapsed, isSelected, onClick, onDelete }: ConversationNavItemProps) => {
  const [menuOpen, setMenuOpen] = useState(false);

  const handleDelete = () => {
    onDelete();
    setMenuOpen(false);
  };

  return (
    <button
      onClick={onClick}
      className={`flex items-center 
        ${isCollapsed ? 'justify-center w-full' : 'justify-between'} 
        ${isSelected && !isCollapsed ? 'bg-bg-hover ml-2 shadow-md shadow-primary-500' : ''}
        ${isSelected && isCollapsed ? 'bg-bg-hover text-text-inverse' : ''}
        p-3 hover:bg-bg-hover rounded-lg transition-all duration-300 group`}
      title={isCollapsed ? title : undefined}
    >
      {!isCollapsed && (
        <>
          <span className="pl-3 text-text-primary truncate flex-1 text-left">{title}</span>
          <Popover
            placement="bottom"
            trigger="click"
            open={menuOpen}
            onOpenChange={setMenuOpen}
            content={
              <button 
                onClick={handleDelete}
                className="text-left min-w-24 self-center transition-colors flex justify-between items-center gap-2 border border-border-base rounded-lg p-2 px-3 bg-error-light/40 text-error-dark hover:bg-error-light/60"
              >
                <IconDelete className="w-4 h-4" />
                <span>删除</span>
              </button>
            }
          >
            <button
              className={`ml-2 hover:bg-primary-100 border border-border-base rounded-full p-1.5 shrink-0 transition-all ${
                menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
              aria-label="更多操作"
              title="更多操作"
              onClick={(e) => e.stopPropagation()}
            >
              <IconEllipsis className="w-4 h-4" />
            </button>
          </Popover>
        </>
      )}
      {isCollapsed && (
        <span className="text-text-primary truncate flex-1 text-center rounded-full">
          {title.slice(0, 2)}
        </span>
      )}
    </button>
  )
}

const UserInfoCard = ({ username, email, avatarUrl, isCollapsed }: UserInfoCardProps) => {
  return (
    <div className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'} ${isCollapsed ? 'px-2' : 'px-4'} py-3`}>
      <Avatar src={avatarUrl} alt="avatar" size={isCollapsed ? 8 : 10} className={`shrink-0`} />
      {!isCollapsed && (
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-sm font-semibold text-text-primary truncate">{username}</span>
          <span className="text-xs text-text-secondary truncate">{email}</span>
        </div>
      )}
    </div>
  )
}


interface AsiderProps {
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function Asider({
  isCollapsed: externalIsCollapsed,
  onToggleCollapse
}: AsiderProps) {
  const [internalIsCollapsed, setInternalIsCollapsed] = useState(false);
  const isCollapsed = externalIsCollapsed !== undefined ? externalIsCollapsed : internalIsCollapsed;
  const handleToggleCollapse = onToggleCollapse || (() => setInternalIsCollapsed(!internalIsCollapsed));

  // 从 store 读取数据
  const chatSummaries = useChatStore((state) => state.chatSummaries);
  const selectedChatId = useChatStore((state) => state.selectedChatId);
  const setSelectedChatId = useChatStore((state) => state.setSelectedChatId);
  const deleteChatSummary = useChatStore((state) => state.deleteChatSummary);
  const createChat = useChatStore((state) => state.createChat);
  const user = useUserStore((state) => state.user);

  // 处理切换对话
  const handleItemClick = (chatId: string) => {
    setSelectedChatId(chatId);
  };

  // 处理删除对话
  const handleDeleteChat = (chatId: string) => {
    deleteChatSummary(chatId);
    // 如果删除的是当前选中的聊天，清空选中状态
    if (selectedChatId === chatId) {
      setSelectedChatId('');
    }
  };

  // 处理新建对话
  const handleNewChat = () => {
    const newChat = createChat({});
    setSelectedChatId(newChat.id);
  };

  return (
    <div className="w-full h-full flex flex-col bg-bg-secondary transition-all duration-300">
      {/* header */}
      <header className={`flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} ${isCollapsed ? 'px-2' : 'px-4'} py-3 border-b border-border-base shrink-0`}>
        {!isCollapsed && (
          <h2 className="text-2xl font-semibold text-text-primary hover:text-shadow-primary-500 hover:text-shadow-md transition-all duration-300 whitespace-nowrap">
            MyCopilot
          </h2>
        )}
        {/* 折叠侧边栏按钮 */}
        <button
          className="bg-bg-primary border border-border-base text-text-primary hover:bg-bg-hover rounded-full p-1.5 transition-colors shrink-0"
          onClick={handleToggleCollapse}
          title={isCollapsed ? "展开侧边栏" : "折叠侧边栏"}
        >
          {isCollapsed ? <IconCollapsedLeft className="w-5 h-5" /> : <IconCollapsedRight className="w-5 h-5" />}
        </button>
      </header>

      {/* main content */}
      <main className={`flex-1 flex flex-col overflow-hidden ${isCollapsed ? 'px-2' : 'px-3'}`}>
        {/* 新建对话按钮 */}
        <button
          onClick={handleNewChat}
          className={`group w-full flex items-center ${isCollapsed ? 'justify-center' : 'justify-center gap-2'} p-3  mt-4 bg-primary-200 border-primary-400 border-2 rounded-lg hover:bg-primary-400 transition-colors shrink-0`}
          title={isCollapsed ? "新对话" : undefined}
        >
          <IconPlus className="w-5 h-5 text-primary-500 group-hover:text-white transition-colors" />
          {!isCollapsed && (
            <span className="text-lg font-bold text-primary-500 group-hover:text-white transition-colors whitespace-nowrap">
              新对话
            </span>
          )}
        </button>

        {/* 对话列表 */}
        <div className="flex-1 overflow-y-auto min-h-0 -mr-3 pr-3">
          <nav className="flex flex-col gap-2 mt-4">
            {chatSummaries.map((summary) => (
              <ConversationNavItem
                key={summary.id}
                id={summary.id}
                title={summary.title}
                isCollapsed={isCollapsed}
                isSelected={selectedChatId === summary.id}
                onClick={() => handleItemClick(summary.id)}
                onDelete={() => handleDeleteChat(summary.id)}
              />
            ))}
          </nav>
        </div>
      </main>

      {/* footer 包含用户信息+app版本信息 */}
      <footer className="flex flex-col shrink-0 border-t border-border-base bg-bg-secondary">
        {user && (
          <UserInfoCard
            username={user.username}
            email={user.email}
            avatarUrl={user.avatarUrl}
            isCollapsed={isCollapsed}
          />
        )}
        {!isCollapsed && (
          <div className="w-full text-center text-xs py-2 text-text-tertiary bg-bg-tertiary flex flex-col items-center">
            <span>MyCopilot Demo</span>
            <span>Author: @Azuxa616</span>
          </div>
        )}
      </footer>
    </div>
  )
}
