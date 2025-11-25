// ConversationNavItem - 对话导航项组件
// 显示单个对话项，支持选中、删除等操作

import { useState } from 'react'
// Components
import Popover from '../common/Popover'
// Assets
import IconEllipsis from '../../assets/icon/ellipsis.svg?react'
import IconDelete from '../../assets/icon/delete.svg?react'

export interface ConversationNavItemProps {
  id: string;
  title: string;
  isCollapsed: boolean;
  isSelected: boolean;
  onClick: () => void;
  onDelete: () => void;
}

export default function ConversationNavItem({ 
  title, 
  isCollapsed, 
  isSelected, 
  onClick, 
  onDelete 
}: ConversationNavItemProps) {
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
              className={`ml-2 hover:bg-primary-100 border border-border-base rounded-full p-1.5 shrink-0 transition-all ${menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
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

