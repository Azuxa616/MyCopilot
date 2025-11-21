import type { ReactNode } from 'react'
import CodeBlock from './CodeBlock'
import MarkdownHeading from './MarkdownHeading'
import MarkdownParagraph from './MarkdownParagraph'
import MarkdownList from './MarkdownList'
import MarkdownBlockquote from './MarkdownBlockquote'
import MarkdownHorizontalRule from './MarkdownHorizontalRule'
import {
  normalizeLineBreaks,
  matchHeading,
  matchUnorderedList,
  matchOrderedList,
  matchBlockquote,
  matchHorizontalRule,
  matchCodeBlockStart,
} from './markdownUtils'

/**
 * 将 Markdown 文本解析为 React 组件数组
 */
export function renderMarkdownWithComponents(content: string): ReactNode[] {
  const normalizedContent = normalizeLineBreaks(content)
  const lines = normalizedContent.split('\n')

  const result: ReactNode[] = []

  let currentParagraph: string[] = []
  let inCodeBlock = false
  let codeBlockContent = ''
  let codeBlockLanguage = ''
  let listItems: string[] = []
  let isOrderedList = false
  let inList = false

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      const paragraphText = currentParagraph.join('\n')
      if (paragraphText.trim()) {
        result.push(
          <MarkdownParagraph
            key={`p-${result.length}`}
            content={paragraphText}
          />,
        )
      }
      currentParagraph = []
    }
  }

  const flushList = () => {
    if (listItems.length > 0) {
      result.push(
        <MarkdownList
          key={`ul-${result.length}`}
          items={listItems}
          ordered={isOrderedList}
        />,
      )
      listItems = []
      inList = false
      isOrderedList = false
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''

    const codeBlockLang = matchCodeBlockStart(line)
    if (codeBlockLang !== null || (inCodeBlock && line === '```')) {
      flushParagraph()
      flushList()

      if (inCodeBlock) {
        result.push(
          <CodeBlock
            key={`codeblock-${result.length}`}
            language={codeBlockLanguage || 'text'}
          >
            {codeBlockContent.trimEnd()}
          </CodeBlock>,
        )
        inCodeBlock = false
        codeBlockContent = ''
        codeBlockLanguage = ''
      } else {
        inCodeBlock = true
        codeBlockLanguage = codeBlockLang ?? ''
      }
      continue
    }

    if (inCodeBlock) {
      codeBlockContent += `${line}\n`
      continue
    }

    const headingMatch = matchHeading(line)
    if (headingMatch) {
      flushParagraph()
      flushList()

      result.push(
        <MarkdownHeading
          key={`h${headingMatch.level}-${result.length}`}
          level={headingMatch.level}
          text={headingMatch.text}
        />,
      )
      continue
    }

    const unorderedListItem = matchUnorderedList(line)
    if (unorderedListItem !== null) {
      flushParagraph()

      if (inList && isOrderedList) {
        flushList()
      }

      listItems.push(unorderedListItem)
      inList = true
      isOrderedList = false
      continue
    }

    const orderedListItem = matchOrderedList(line)
    if (orderedListItem !== null) {
      flushParagraph()

      if (inList && !isOrderedList) {
        flushList()
      }

      listItems.push(orderedListItem)
      inList = true
      isOrderedList = true
      continue
    }

    const blockquoteContent = matchBlockquote(line)
    if (blockquoteContent !== null) {
      flushParagraph()
      flushList()

      result.push(
        <MarkdownBlockquote
          key={`blockquote-${result.length}`}
          content={blockquoteContent}
        />,
      )
      continue
    }

    if (matchHorizontalRule(line)) {
      flushParagraph()
      flushList()

      result.push(
        <MarkdownHorizontalRule
          key={`hr-${result.length}`}
        />,
      )
      continue
    }

    if (line.trim() === '') {
      flushParagraph()
      flushList()
      continue
    }

    if (!inList) {
      currentParagraph.push(line)
    } else {
      flushList()
      currentParagraph.push(line)
    }
  }

  flushParagraph()
  flushList()

  return result
}

interface MarkdownRendererProps {
  content: string
}

/**
 * 简单包装组件，方便在消息气泡中直接使用
 */
export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return <>{renderMarkdownWithComponents(content)}</>
}


