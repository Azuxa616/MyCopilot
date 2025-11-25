// Uploader - 文件上传组件
// 提供文件选择功能，并转换为Attachment对象

import { useRef } from 'react'
// Types
import type { Attachment } from '../../types/chat'

interface UploaderProps {
  onFileSelect?: (file: File) => void
  onAttachmentReady?: (attachment: Attachment) => void
}

export default function Uploader({ onFileSelect, onAttachmentReady }: UploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // 调用文件选择回调
    onFileSelect?.(file)

    // 创建 Attachment 对象
    const attachment: Attachment = {
      id: `attachment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
    }

    // 调用附件就绪回调
    onAttachmentReady?.(attachment)

    // 重置 input，允许重复选择同一文件
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        id="fileInput"
        onChange={handleFileChange}
      />
      <label
        htmlFor="fileInput"
        title="上传文件"
        className="min-w-100 px-4 py-2 bg-primary-500 text-white rounded-full hover:bg-primary-600 transition-colors font-medium shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-block"
      >
        上传文件
      </label>
    </div>
  )
}
