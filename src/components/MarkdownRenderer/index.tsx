import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypePrismPlus from 'rehype-prism-plus'

import 'prismjs/themes/prism-tomorrow.css'
import { markdownComponents } from './components'

export interface MarkdownRendererProps {
  content: string
}

function ReactMarkdownRenderer({ content }: MarkdownRendererProps) {
  if (!content) {
    return null
  }

  return (
    <div className="flex flex-col gap-2 text-[13px] font-normal leading-relaxed text-text-primary">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypePrismPlus, { ignoreMissing: true }]]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export default memo(ReactMarkdownRenderer)

