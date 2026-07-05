// Uploader - 文件选择组件
// 提供文件选择功能，仅返回 File 对象，由调用方处理附件逻辑

import { useRef } from 'react'

interface UploaderProps {
  onFileSelect?: (file: File) => void
}

export default function Uploader({ onFileSelect }: UploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // 调用文件选择回调，由调用方处理附件创建
    onFileSelect?.(file)

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
        选择文件
      </label>
    </div>
  )
}
