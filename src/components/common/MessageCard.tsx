import type { ReactNode } from 'react'
import type { Message } from '../../types/chat'
import { MessageRole, MessageStatus } from '../../types/chat'
import { getRelativeTime } from '../../utils/time'
import ReactMarkdownRenderer from '../MarkdownRenderer'
import Avatar from './Avatar'
import MessageActions from './MessageActions'

interface MessageCardProps {
  /** 消息数据 */
  message: Message
  /** 是否处于流式响应阶段（SSE 中） */
  isStreaming?: boolean
  /** 自定义外层类名（用于列表中微调间距等） */
  className?: string
  /** 点击重试（仅在发送失败时展示） */
  onRetry?: () => void
  /** 删除当前消息 */
  onDelete?: () => void
  /** 复制当前消息内容 */
  onCopy?: () => void
  /** 预留：自定义操作区域 */
  extraActions?: ReactNode
  /** 当前登录用户头像（用于 user 消息） */
  userAvatarUrl?: string
  /** AI 助手头像（用于 assistant 消息） */
  assistantAvatarUrl?: string
}

export default function MessageCard({
  message,
  isStreaming,
  className = '',
  onRetry,
  onDelete,
  onCopy,
  extraActions,
}: MessageCardProps) {
  const isUser = message.role === MessageRole.USER
  const isAssistant = message.role === MessageRole.ASSISTANT
  const isSystem = message.role === MessageRole.SYSTEM

  const isSending = message.status === MessageStatus.SENDING
  const isFailed = message.status === MessageStatus.FAILED

  const timeLabel = getRelativeTime(message.timestamp)

  // 气泡样式
  let bubbleClass =
    'max-w-[80%] rounded-2xl px-4 py-2 text-sm shadow-sm border border-border-light'

  if (isUser) {
    bubbleClass += ' bg-primary-500 text-text-inverse rounded-tr-sm '
  } else if (isAssistant) {
    bubbleClass += ' bg-bg-elevated text-text-primary rounded-tl-sm border-l-5 border-b-5 border-border-base'
  } else if (isSystem) {
    bubbleClass =
      'max-w-[70%] text-xs px-3 py-1 rounded-full bg-bg-tertiary text-text-tertiary border border-border-base'
  }

  if (isFailed) {
    bubbleClass += ' border-error bg-error-light/10'
  }

  // SSE 流式光标
  const renderStreamingCursor = () => {
    if (!isStreaming || !isAssistant) return null
    return (
      <span className="inline-block w-[6px] h-4 align-baseline bg-text-primary/60 animate-pulse ml-0.5" />
    )
  }

  // 状态文本
  const statusText =
    (isSending && '发送中...') ||
    (isFailed && '发送失败') ||
    (isStreaming && '正在生成...') ||
    ''

  // 内容区域：使用 Markdown 渲染器渲染用户与助手消息
  const renderContent = () => {
    if (isSystem) {
      return <span className="whitespace-pre-wrap wrap-break-word">{message.content}</span>
    }
    if (isUser) {
      return (
        <div className="max-w-none whitespace-pre-wrap wrap-break-word text-[13px] leading-relaxed text-left">
          {message.content}
        </div>
      )
    }
    return (
      <div className="max-w-none whitespace-pre-wrap wrap-break-word text-[13px] leading-relaxed text-left font-normal">
        <ReactMarkdownRenderer content={message.content} />
        {renderStreamingCursor()}
      </div>
    )
  }

  // 操作区（右下角/右上角小图标位）
  const renderActions = () => {
    if (isSystem) return null

    return (
      <MessageActions
        statusText={statusText}
        showRetry={isFailed && !!onRetry}
        onCopy={onCopy}
        onDelete={onDelete}
        onRetry={onRetry}
        extraActions={extraActions}
      />
    )
  }

  // 时间戳 & 角色标签
  const renderMeta = () => {
    if (isSystem) return null
    const roleLabel = isUser ? "我" : 'MyCopilot'
    return (
      <div className="mb-1 flex items-center gap-2 text-[11px] text-text-tertiary px-1">
        <span>{roleLabel}</span>

      </div>
    )
  }

  // 系统消息：不展示头像，居中即可
  if (isSystem) {
    return (
      <div
        className={`w-full flex justify-center mb-3 ${className}`}
        role="article"
        aria-label={`系统消息，时间：${timeLabel}`}
      >
        <div className={bubbleClass}>{renderContent()}</div>
      </div>
    )
  }

  // 头像路径
  const effectiveUserAvatar ='src/assets/img/avatar-user.png'
  const effectiveAssistantAvatar ='src/assets/img/avatar-ai.svg'
  console.log("isAssistant",isAssistant)
  return (
    <div
      className={`w-full flex ${isUser ? 'justify-end' : 'justify-start'} mb-3 ${className}`}
      role="article"
      aria-label={`${isUser ? '用户' : isAssistant ? '助手' : '系统'}消息，时间：${timeLabel}`}
    >
      {isAssistant && (
        <div className="mr-2 shrink-0">
          <Avatar
            src={effectiveAssistantAvatar}
            alt="MyCopilot 头像"
            size={12}
          />
        </div>
      )}
      <div className={`flex flex-col items-${isUser ? 'end' : 'start'} w-[calc(100%-100px)]`}>
        {renderMeta()}
        <div className={bubbleClass}>{renderContent()}</div>
        {renderActions()}
      </div>
      {!isAssistant && (
        <div className="ml-2 shrink-0">
          <Avatar
            src={effectiveUserAvatar}
            alt="用户头像"
            size={12}
          />
        </div>
      )}
    </div>
  )
}
