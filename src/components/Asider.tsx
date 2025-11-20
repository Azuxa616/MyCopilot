import { useState } from "react";

//Types
import type { Chat } from '../types/chat';
//Icons
import IconCollapsedLeft from '../assets/icon/collapsed-left.svg?react';
import IconCollapsedRight from '../assets/icon/collapsed-right.svg?react';
import IconEllipsis from '../assets/icon/ellipsis.svg?react';
import IconPlus from '../assets/icon/plus.svg?react';


interface AsiderProps {
  chatList?: Chat[];
  setChatList?: (chatList: Chat[]) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

interface UserInfoCardProps {
  username: string;
  email: string;
  avatarUrl: string;
  isCollapsed: boolean;
}

interface ConversationNavItemProps {
  id: string;
  defaultTitle: string;
  isCollapsed: boolean;
  isSelected: boolean;
  onClick: () => void;
}


const ConversationNavItem = ({ id: _id, defaultTitle, isCollapsed, isSelected, onClick }: ConversationNavItemProps) => {
  const [title] = useState<string>(defaultTitle || '新对话');
  return (
    <button
      onClick={onClick}
      className={` flex items-center 
        ${isCollapsed ? 'justify-center w-full' : 'justify-between  '} 
        ${isSelected && !isCollapsed ?  ' bg-bg-hover ml-2  shadow-md shadow-primary-500 ' : ''}
        ${isSelected && isCollapsed ? 'bg-bg-hover text-text-inverse ' : ''}
        p-3  hover:bg-bg-hover rounded-lg transition-all duration-300 group`
      }
      title={isCollapsed ? title : undefined}
    >
      {!isCollapsed && (
        <>
          <span className="pl-3  text-text-primary truncate flex-1 text-left">{title}</span>
          <button
            onClick={(e) => e.stopPropagation()}
            title="更多操作"
            className={`${isCollapsed ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 ml-2'}
             bg-bg-primary border border-border-base text-text-primary hover:bg-bg-hover 
             rounded-full p-1.5 transition-all shrink-0 
             ${isSelected ? 'translate-x-[-10]' : ''}`}
          >
            <IconEllipsis className="w-4 h-4" />
          </button>
        </>
      )}
      {isCollapsed && (
        <span className=" text-text-primary truncate flex-1 text-cente rounded-full">{title.slice(0, 2)}</span>
      )}
    </button>
  )
}

const UserInfoCard = ({ username, email, avatarUrl, isCollapsed }: UserInfoCardProps) => {
  return (
    <div className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'} ${isCollapsed ? 'px-2' : 'px-4'} py-3`}>
      <img
        src={avatarUrl}
        alt="avatar"
        className={`${isCollapsed ? 'w-8 h-8' : 'w-10 h-10'} rounded-full shrink-0`}
        title={isCollapsed ? username : undefined}
      />
      {!isCollapsed && (
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-sm font-semibold text-text-primary truncate">{username}</span>
          <span className="text-xs text-text-secondary truncate">{email}</span>
        </div>
      )}
    </div>
  )
}


export default function Asider({
  chatList: _chatList,
  setChatList: _setChatList,
  isCollapsed: externalIsCollapsed,
  onToggleCollapse
}: AsiderProps) {
  const [internalIsCollapsed, setInternalIsCollapsed] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const isCollapsed = externalIsCollapsed !== undefined ? externalIsCollapsed : internalIsCollapsed;
  const handleToggleCollapse = onToggleCollapse || (() => setInternalIsCollapsed(!internalIsCollapsed));
  

  //处理切换对话
  const handleItemClick = (chatId: string) => {
    setSelectedChatId(chatId);
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
            <ConversationNavItem 
              id="chat-1" 
              defaultTitle="新对话" 
              isCollapsed={isCollapsed} 
              isSelected={selectedChatId === 'chat-1'}
              onClick={() => handleItemClick('chat-1')}
            />
            <ConversationNavItem 
              id="chat-2" 
              defaultTitle="新对话" 
              isCollapsed={isCollapsed} 
              isSelected={selectedChatId === 'chat-2'}
              onClick={() => handleItemClick('chat-2')}
            />
            <ConversationNavItem 
              id="chat-3" 
              defaultTitle="新对话" 
              isCollapsed={isCollapsed} 
              isSelected={selectedChatId === 'chat-3'}
              onClick={() => handleItemClick('chat-3')}
            />
          </nav>
        </div>
      </main>

      {/* footer 包含用户信息+app版本信息 */}
      <footer className="flex flex-col shrink-0 border-t border-border-base bg-bg-secondary">
        <UserInfoCard
          username="Azuxa616"
          email="azuxa616@gmail.com"
          avatarUrl="https://avatars.githubusercontent.com/u/123456789?v=4"
          isCollapsed={isCollapsed}
        />
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
