import type { ReactNode } from 'react'
import { renderInlineElements } from './markdownUtils'

interface MarkdownBlockquoteProps {
  content: string
}

export default function MarkdownBlockquote({ content }: MarkdownBlockquoteProps): ReactNode {
  return (
    <blockquote className="my-3 border-l-4 border-border-base bg-bg-tertiary/40 px-3 py-2 text-[13px] text-text-secondary">
      {renderInlineElements(content)}
    </blockquote>
  )
}


