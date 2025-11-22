import { isValidElement, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypePrismPlus from 'rehype-prism-plus'

import 'prismjs/themes/prism-tomorrow.css'

export interface MarkdownRendererProps {
  content: string
}

const headingClasses = [
  'text-[32px] font-bold text-text-primary mb-3 mt-4', // h1
  'text-[24px] font-bold text-text-primary mb-2.5 mt-3', // h2
  'text-[20px] font-bold text-text-primary mb-2 mt-2.5', // h3
  'text-[18px] font-semibold text-text-primary mb-1.5 mt-2', // h4
  'text-[16px] font-semibold text-text-secondary mb-1.5 mt-1.5', // h5
  'text-[15px] font-semibold text-text-secondary mb-1 mt-1.5', // h6 
] as const

const languageAliasMap: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  yml: 'yaml',
  md: 'markdown',
  markup: 'html',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  golang: 'go',
  rs: 'rust',
  rb: 'ruby',
  kt: 'kotlin',
  ps: 'powershell',
  ps1: 'powershell',
}

/**
 * 合并 classNames
 */
const cx = (...classNames: Array<string | undefined | null | false>) =>
  classNames.filter(Boolean).join(' ')

const extractLanguage = (className?: string) => {
  if (!className) {
    return 'text'
  }
  const match = /language-([\w-]+)/.exec(className)
  if (!match) {
    return 'text'
  }

  const raw = match[1]?.toLowerCase() ?? 'text'
  return languageAliasMap[raw] ?? raw
}
/**
 *  Markdown 组件
 */
const markdownComponents: Components = {
  h1: ({ node, children, ...props }) => (
    <h1 {...props} className={cx(headingClasses[0], props.className)}>
      {children}
    </h1>
  ),
  h2: ({ node, children, ...props }) => (
    <h2 {...props} className={cx(headingClasses[1], props.className)}>
      {children}
    </h2>
  ),
  h3: ({ node, children, ...props }) => (
    <h3 {...props} className={cx(headingClasses[2], props.className)}>
      {children}
    </h3>
  ),
  h4: ({ node, children, ...props }) => (
    <h4 {...props} className={cx(headingClasses[3], props.className)}>
      {children}
    </h4>
  ),
  h5: ({ node, children, ...props }) => (
    <h5 {...props} className={cx(headingClasses[4], props.className)}>
      {children}
    </h5>
  ),
  h6: ({ node, children, ...props }) => (
    <h6 {...props} className={cx(headingClasses[5], props.className)}>
      {children}
    </h6>
  ),
  p: ({ node, children, ...props }) => (
    <p
      {...props}
      className={cx('mb-3 leading-relaxed text-text-primary font-normal', props.className)}
    >
      {children}
    </p>
  ),
  strong: ({ node, children, ...props }) => (
    <strong
      {...props}
      className={cx('font-bold text-text-primary', props.className)}
    >
      {children}
    </strong>
  ),
  em: ({ node, children, ...props }) => (
    <em
      {...props}
      className={cx('italic text-text-primary', props.className)}
    >
      {children}
    </em>
  ),
  ul: ({ node, children, ...props }) => (
    <ul {...props} className={cx('mb-3 ml-5 list-disc', props.className)}>
      {children}
    </ul>
  ),
  ol: ({ node, children, ...props }) => (
    <ol {...props} className={cx('mb-3 ml-5 list-decimal', props.className)}>
      {children}
    </ol>
  ),
  li: ({ node, children, ...props }) => (
    <li
      {...props}
      className={cx('mb-0.5 text-text-primary font-normal', props.className)}
    >
      {children}
    </li>
  ),
  blockquote: ({ node, children, ...props }) => (
    <blockquote
      {...props}
      className={cx(
        'my-3 border-l-4 border-border-base bg-bg-tertiary/40 px-3 py-2 text-[13px] text-text-secondary',
        props.className,
      )}
    >
      {children}
    </blockquote>
  ),
  hr: (props) => (
    <hr
      {...props}
      className={cx('my-4 border-t border-border-base', props.className)}
    />
  ),
  a: ({ node, children, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      className={cx(
        'text-brand-primary underline decoration-dotted underline-offset-2 hover:text-brand-primary/80',
        props.className,
      )}
    >
      {children}
    </a>
  ),
  img: ({ node, alt, ...props }) => (
    // eslint-disable-next-line jsx-a11y/alt-text
    <img
      {...props}
      alt={alt}
      loading="lazy"
      className={cx(
        'my-3 max-h-[360px] w-full rounded-lg object-cover',
        props.className,
      )}
    />
  ),
  table: ({ node, children, ...props }) => (
    <div className="my-4 w-full overflow-x-auto">
      <table
        {...props}
        className={cx(
          'min-w-full table-auto border border-border-base text-[13px]',
          props.className,
        )}
      >
        {children}
      </table>
    </div>
  ),
  thead: ({ node, children, ...props }) => (
    <thead
      {...props}
      className={cx('bg-bg-secondary text-text-primary', props.className)}
    >
      {children}
    </thead>
  ),
  tbody: ({ node, children, ...props }) => (
    <tbody
      {...props}
      className={cx('bg-bg-primary', props.className)}
    >
      {children}
    </tbody>
  ),
  th: ({ node, children, ...props }) => (
    <th
      {...props}
      className={cx('px-3 py-2 text-left font-semibold', props.className)}
    >
      {children}
    </th>
  ),
  td: ({ node, children, ...props }) => (
    <td
      {...props}
      className={cx('px-3 py-2 align-top text-text-secondary', props.className)}
    >
      {children}
    </td>
  ),
  code: ({ node, className, children, ...props }) => {
    const inline = !className || !className.includes('language-')
    if (inline) {
      return (
        <code
          {...props}
          className={cx(
            'rounded-md bg-bg-tertiary/80 px-1.5 py-0.5 font-mono text-[13px] text-text-secondary',
            className,
          )}
        >
          {children}
        </code>
      )
    }
    return (
      <code {...props} className={className}>
        {children}
      </code>
    )
  },
  pre: ({ node, children, ...props }) => {
    const child = Array.isArray(children) ? children[0] : children
    if (!isValidElement(child)) {
      return (
        <pre
          {...props}
          className={cx(
            'my-4 overflow-auto rounded-lg bg-[#111] px-3 py-3 font-mono text-[13px] leading-[1.6] text-[#f8f8f2]',
            props.className,
          )}
        >
          {children}
        </pre>
      )
    }

    const childClassName: string =
      (child.props as { className?: string })?.className ?? ''
    const language = extractLanguage(childClassName)
    const languageClass =
      childClassName?.split(' ').find((cls: string) => cls.startsWith('language-')) ??
      `language-${language}`

    return (
      <div
        className="my-4 overflow-hidden rounded-lg border border-border-base bg-[#0c0c0c] text-[#f8f8f2]"
        data-language={language}
      >
        <div className="flex items-center justify-between bg-[#1c1c1c] px-3 py-1 text-[11px] uppercase tracking-wide text-text-tertiary">
          <span>{language}</span>
        </div>
        <pre
          {...props}
          className={cx(
            languageClass,
            'm-0 max-h-[480px] overflow-auto px-3 py-3 font-mono text-[13px] leading-[1.6]',
          )}
        >
          {child}
        </pre>
      </div>
    )
  },
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

