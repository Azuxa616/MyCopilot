// UserInfoCard - 用户信息卡片组件
// 显示用户头像、用户名和邮箱

// Components
import Avatar from '../common/Avatar'
// Assets
import userAvatar from '../../assets/img/avatar-user.png'

// 头像URL处理函数
const getAvatarUrl = (avatarUrl: string): string => {
  // 如果是本地头像路径，使用导入的图片
  if (avatarUrl === 'src/assets/img/avatar-user.png') {
    return userAvatar
  }
  // 否则返回原始URL（可能是网络图片）
  return avatarUrl
}

export interface UserInfoCardProps {
  username: string;
  email: string;
  avatarUrl: string;
  isCollapsed: boolean;
  onClick?: () => void;
}

export default function UserInfoCard({ 
  username, 
  email, 
  avatarUrl, 
  isCollapsed, 
  onClick 
}: UserInfoCardProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'} ${isCollapsed ? 'px-2' : 'px-4'} py-3 hover:bg-bg-hover rounded-lg transition-colors cursor-pointer`}
      title={isCollapsed ? "设置" : undefined}
    >
      <Avatar src={getAvatarUrl(avatarUrl)} alt="avatar" size={isCollapsed ? 8 : 10} className={`shrink-0`} />
      {!isCollapsed && (
        <div className="flex flex-col min-w-0 flex-1 text-left">
          <span className="text-sm font-semibold text-text-primary truncate">{username}</span>
          <span className="text-xs text-text-secondary truncate">{email}</span>
        </div>
      )}
    </button>
  )
}

