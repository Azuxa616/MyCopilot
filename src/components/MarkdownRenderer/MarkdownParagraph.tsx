import type { ReactNode } from 'react'
import { renderInlineElements } from './markdownUtils'

interface MarkdownParagraphProps {
  content: string
}

export default function MarkdownParagraph({ content }: MarkdownParagraphProps): ReactNode {
  if (!content.trim()) {
    return null
  }

  return (
    <p className="mb-3 leading-relaxed text-text-primary">
      {renderInlineElements(content)}
    </p>
  )
}


