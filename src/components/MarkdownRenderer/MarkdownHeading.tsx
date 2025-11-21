import type { ReactNode } from 'react'
import { renderInlineElements } from './markdownUtils'

interface MarkdownHeadingProps {
  level: number
  text: string
}

// 在聊天气泡里不适合过大的标题字号，这里整体压缩一档
const headingClasses = [
  'text-[15px] font-semibold text-text-primary mb-2 mt-3', // h1
  'text-[14px] font-semibold text-text-primary mb-2 mt-2', // h2
  'text-[13px] font-semibold text-text-primary mb-1.5 mt-2', // h3
  'text-[13px] font-medium text-text-primary mb-1.5 mt-1.5', // h4
  'text-[12px] font-medium text-text-secondary mb-1 mt-1.5', // h5
  'text-[12px] font-medium text-text-secondary mb-1 mt-1', // h6
]

export default function MarkdownHeading({ level, text }: MarkdownHeadingProps): ReactNode {
  const validLevel = Math.max(1, Math.min(6, level))
  const HeadingTag = `h${validLevel}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

  return (
    <HeadingTag className={headingClasses[validLevel - 1]}>
      {renderInlineElements(text)}
    </HeadingTag>
  )
}


