// MessageCard - 消息卡片组件
// 显示单条消息，支持用户消息和AI回复，包含附件、操作按钮等功能

import { useMemo } from 'react'
import type { ReactNode } from 'react'
// Types
import type { Message } from '../../types/chat'
import { MessageRole, MessageStatus } from '../../types/chat'
// Components
import ReactMarkdownRenderer from '../MarkdownRenderer'
import Avatar from './Avatar'
import MessageActions from './MessageActions'
import AttachmentCard from '../Sender/AttachmentCard'
// Utils
import { getRelativeTime } from '../../utils/time'
import { showMessageAlert } from './Alert/alertUtils'
// Assets
import IconRetry from '../../assets/icon/retry.svg?react'
import userAvatar from '../../assets/img/avatar-user.png'
import aiAvatar from '../../assets/img/avatar-ai.svg'

// 将组件移到外部，避免在渲染期间创建
interface RenderStreamingCursorProps {
  isStreaming: boolean
  isAssistant: boolean
}

function RenderStreamingCursor({ isStreaming, isAssistant }: RenderStreamingCursorProps) {
  if (!isStreaming || !isAssistant) return null
  return (
    <span className="inline-block w-[6px] h-4 align-baseline bg-text-primary/60 animate-pulse ml-0.5" />
  )
}

interface RenderContentProps {
  message: Message
  isSystem: boolean
  isUser: boolean
  isAssistant: boolean
  isFailed: boolean
  isStreaming: boolean
}

function RenderContent({ message, isSystem, isUser, isAssistant, isFailed, isStreaming }: RenderContentProps) {
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

  // 如果助手消息失败，显示失败提示
  if (isAssistant && isFailed) {
    return (
      <div className="max-w-none px-4 py-3 whitespace-pre-wrap wrap-break-word text-[13px] leading-relaxed text-left font-normal">
        <div className="flex items-center gap-2 text-error">
          <span className="text-error">⚠️</span>
          <span>{message.error || '生成失败，请重试'}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-none px-4 py-2 whitespace-pre-wrap wrap-break-word text-[13px] leading-relaxed text-left font-normal">
      <ReactMarkdownRenderer content={message.content} />
      <RenderStreamingCursor isStreaming={isStreaming} isAssistant={isAssistant} />
    </div>
  )
}

interface RenderActionsProps {
  isSystem: boolean
  isAssistant: boolean
  isFailed: boolean
  isUser: boolean
  onRetry?: () => void
  onDelete?: () => void
  onCopy: () => void
  onRegenerate?: () => void
  showRegenerate?: boolean
  extraActions?: ReactNode
}

function RenderActions({
  isSystem,
  isAssistant,
  isFailed,
  isUser,
  onRetry,
  onDelete,
  onCopy,
  onRegenerate,
  showRegenerate,
  extraActions,
}: RenderActionsProps) {
  if (isSystem) return null

  // 助手消息失败时，显示重试按钮
  if (isAssistant && isFailed && onRetry) {
    return (
      <div className="mt-2 px-4 pb-2">
        <button
          type="button"
          onClick={onRetry}
          className="px-3 py-1.5 rounded-md bg-error-light/40 text-error-dark hover:bg-error-light/60 text-[12px] font-medium flex items-center gap-1.5"
          aria-label="重试生成"
        >
          <IconRetry className="w-4 h-4 text-error-dark" />
          <span>重试</span>
        </button>
      </div>
    )
  }

  return (
    <MessageActions
      sender={isUser ? 'user' : 'assistant'}
      showRetry={isFailed && !!onRetry && isUser}
      showRegenerate={showRegenerate && !!onRegenerate}
      onCopy={onCopy}
      onDelete={onDelete}
      onRetry={onRetry}
      onRegenerate={onRegenerate}
      extraActions={extraActions}
    />
  )
}

interface RenderMetaProps {
  isSystem: boolean
  isUser: boolean
}

function RenderMeta({ isSystem, isUser }: RenderMetaProps) {
  if (isSystem) return null
  const roleLabel = isUser ? "我" : 'MyCopilot'
  return (
    <div className="mb-1 flex items-center gap-2 text-[11px] text-text-tertiary px-1">
      <span>{roleLabel}</span>
    </div>
  )
}
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
  /** 点击重新生成（仅在用户消息下显示，用于重新生成AI回复） */
  onRegenerate?: () => void
  /** 是否显示重新生成按钮 */
  showRegenerate?: boolean
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
  onRegenerate,
  showRegenerate,
  extraActions,
}: MessageCardProps) {
  const isUser = message.role === MessageRole.USER
  const isAssistant = message.role === MessageRole.ASSISTANT
  const isSystem = message.role === MessageRole.SYSTEM
  const isSending = message.status === MessageStatus.SENDING
  const isFailed = message.status === MessageStatus.FAILED

  const timeLabel = getRelativeTime(message.timestamp)

  // 气泡样式
  let bubbleClass = 'max-w-[80%] rounded-2xl  text-sm shadow-sm border border-border-light overflow-hidden'

  if (isUser) {
    bubbleClass += 'min-w-16  py-2 px-4 bg-primary-500 text-text-inverse rounded-tr-sm '
  } else if (isAssistant) {
    bubbleClass += ' bg-bg-elevated text-text-primary rounded-tl-sm border-l-5 border-b-5 border-border-base'
  } else if (isSystem) {
    bubbleClass =
      'max-w-[70%] text-xs px-3 py-1 rounded-full bg-bg-tertiary text-text-tertiary border border-border-base'
  }

  if (isFailed) {
    bubbleClass += ' border-error/80 bg-error-light/10'
  }

  // 状态栏
  // 使用memo方式SSE流式响应时，避免重复渲染
  const StatusBar = useMemo(() => {
    if (isSystem || isUser) return null
    if (isFailed) {
      return (
        <div className="w-full h-1 bg-error-light ml-0.5 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1/4 h-full bg-error-500 animate-slide-loading rounded-full" />
        </div>
      )
    }
    if (isSending) {
      return (
        <div className="w-full h-1 bg-primary-100 ml-0.5 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1/4 h-full bg-primary-500 animate-slide-loading rounded-full" />
        </div>
      )
    }
    return (
      <div className="w-full h-1  bg-success-light animate-pulse   ml-0.5" />
    )
  }, [isSending, isSystem, isUser, isFailed])

  // 系统消息：居中
  if (isSystem) {
    return (
      <div
        className={`w-full flex justify-center mb-3 ${className}`}
        role="article"
        aria-label={`系统消息，时间：${timeLabel}`}
      >
        <div className={bubbleClass}>
          <RenderContent
            message={message}
            isSystem={isSystem}
            isUser={isUser}
            isAssistant={isAssistant}
            isFailed={isFailed}
            isStreaming={isStreaming ?? false}
          />
        </div>
      </div>
    )
  }

  // 头像路径
  const effectiveUserAvatar = userAvatar
  const effectiveAssistantAvatar = aiAvatar
  // console.log("isAssistant",isAssistant)

  // 复制消息内容
  const handleCopy = () => {
    navigator.clipboard.writeText(message.content).then(() => {
      showMessageAlert.info('复制成功')
    }).catch(() => {
      showMessageAlert.error('复制失败')
    })
  }
  //分享消息内容
  //todo：结合modal，渲染分享卡片
  // const handleShare = () => {
  //   navigator.clipboard.writeText(message.content).then(() => {
  //     showMessageAlert.info('分享成功')
  //   }).catch(() => {
  //     showMessageAlert.error('分享失败')
  //   })
  // }
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
      <div className={`flex flex-col items-${isUser ? 'end' : 'start'} gap-1 w-[calc(100%-100px)] `}>
        <RenderMeta isSystem={isSystem} isUser={isUser} />

        <div className={bubbleClass}>
          {StatusBar}
          <RenderContent
            message={message}
            isSystem={isSystem}
            isUser={isUser}
            isAssistant={isAssistant}
            isFailed={isFailed}
            isStreaming={isStreaming ?? false}
          />
        </div>

        {message.attachments.length > 0 && (
          <div className="ml-2 shrink-0">
            <AttachmentCard attachment={message.attachments[0]} />
          </div>
        )}
        <RenderActions
          isSystem={isSystem}
          isAssistant={isAssistant}
          isFailed={isFailed}
          isUser={isUser}
          onRetry={onRetry}
          onDelete={onDelete}
          onCopy={handleCopy}
          onRegenerate={onRegenerate}
          showRegenerate={showRegenerate}
          extraActions={extraActions}
        />
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
