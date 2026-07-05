// MarkdownRenderer Components - Markdown组件定义
// 定义react-markdown使用的自定义组件

import { isValidElement, useState } from 'react'
import type React from 'react'
import type { Components } from 'react-markdown'
// Utils
import { headingClasses } from './constants'
import { cx, extractLanguage } from './utils'
// Assets
import IconCopy from '../../assets/icon/copy.svg?react'

/**
 * Pre 组件 - 代码块容器，包含复制功能
 */
// eslint-disable-next-line react-refresh/only-export-components
function PreComponent({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) {
  const child = Array.isArray(children) ? children[0] : children
  const [copied, setCopied] = useState(false)

  if (!isValidElement(child)) {
    return (
      <pre
        {...props}
        className={cx(
          'my-4 overflow-auto rounded-lg bg-[#111] px-3 py-3 font-mono text-[13px] leading-[1.6] text-[#f8f8f2]',
          props.className as string,
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

  // 提取代码内容
  const getCodeContent = (element: React.ReactElement): string => {
    const props = element.props as { children?: React.ReactNode }
    if (typeof props.children === 'string') {
      return props.children
    }
    if (Array.isArray(props.children)) {
      return props.children
        .map((child: React.ReactNode) => {
          if (typeof child === 'string') {
            return child
          }
          if (isValidElement(child)) {
            return getCodeContent(child)
          }
          return ''
        })
        .join('')
    }
    return ''
  }

  const codeContent = getCodeContent(child)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeContent)
      setCopied(true)
      setTimeout(() => {
        setCopied(false)
      }, 2000)
    } catch (err) {
      console.error('复制失败:', err)
    }
  }

  return (
    <div
      className="my-4 overflow-hidden rounded-lg border border-border-base bg-[#0c0c0c] text-[#f8f8f2] group"
      data-language={language}
    >
      <div className="flex items-center justify-between bg-[#1c1c1c] px-3 py-1 text-[11px] uppercase tracking-wide text-text-tertiary">
        <span>{language}</span>
        <button
          type="button"
          onClick={handleCopy}
          className={`flex items-center gap-1 px-2 py-1 rounded hover:bg-bg-primary/20 transition-colors text-text-inverse hover:text-text-tertiary `}
          aria-label="复制代码"
        >
          <IconCopy className="w-3.5 h-3.5" />
          {copied ? (
            <span className="text-[12px]">已复制</span>
          ) : (
            <span className="text-[12px]">复制</span>
          )}
        </button>
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
}

/**
 * Markdown 组件
 */
export const markdownComponents: Components = {
  h1: ({ children, ...props }) => (
    <h1 {...props} className={cx(headingClasses[0], props.className)}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 {...props} className={cx(headingClasses[1], props.className)}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 {...props} className={cx(headingClasses[2], props.className)}>
      {children}
    </h3>
  ),
  h4: ({ children, ...props }) => (
    <h4 {...props} className={cx(headingClasses[3], props.className)}>
      {children}
    </h4>
  ),
  h5: ({ children, ...props }) => (
    <h5 {...props} className={cx(headingClasses[4], props.className)}>
      {children}
    </h5>
  ),
  h6: ({ children, ...props }) => (
    <h6 {...props} className={cx(headingClasses[5], props.className)}>
      {children}
    </h6>
  ),
  p: ({ children, ...props }) => (
    <p
      {...props}
      className={cx('text-[15px] mb-3 leading-relaxed text-text-primary font-normal', props.className)}
    >
      {children}
    </p>
  ),
  strong: ({ children, ...props }) => (
    <strong
      {...props}
      className={cx('text-[15px] font-bold text-text-primary', props.className)}
    >
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em
      {...props}
      className={cx('text-[15px] italic text-text-primary', props.className)}
    >
      {children}
    </em>
  ),
  ul: ({ children, ...props }) => (
    <ul {...props} className={cx('text-[15px] mb-3 ml-5 list-disc', props.className)}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol {...props} className={cx('text-[15px] mb-3 ml-5 list-decimal', props.className)}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li
      {...props}
      className={cx('text-[15px] mb-0.5 text-text-primary font-normal', props.className)}
    >
      {children}
    </li>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote
      {...props}
      className={cx(
        'text-[15px] my-3 border-l-4 border-border-base bg-bg-tertiary/40 px-3 py-2 text-[13px] text-text-secondary',
        props.className,
      )}
    >
      {children}
    </blockquote>
  ),
  hr: (props) => (
    <hr
      {...props}
      className={cx('text-[15px] my-4 border-t border-border-base', props.className)}
    />
  ),
  a: ({ children, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      className={cx(
        'text-[15px] bg-primary-200/30 px-1 py-0.5 rounded-md text-brand-primary underline decoration-dotted underline-offset-2 hover:text-brand-primary/80 hover:bg-bg-primary hover:border-primary-500 hover:border ',
        props.className,
      )}
    >
      {children}
    </a>
  ),
  img: ({ alt, ...props }) => (
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
  table: ({ children, ...props }) => (
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
  thead: ({ children, ...props }) => (
    <thead
      {...props}
      className={cx('bg-bg-secondary text-text-primary', props.className)}
    >
      {children}
    </thead>
  ),
  tbody: ({ children, ...props }) => (
    <tbody
      {...props}
      className={cx('bg-bg-primary', props.className)}
    >
      {children}
    </tbody>
  ),
  th: ({ children, ...props }) => (
    <th
      {...props}
      className={cx('px-3 py-2 text-left font-semibold', props.className)}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td
      {...props}
      className={cx('px-3 py-2 align-top text-text-secondary', props.className)}
    >
      {children}
    </td>
  ),
  code: ({ className, children, ...props }) => {
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
  pre: ({ children, ...props }) => (
    <PreComponent {...props}>{children}</PreComponent>
  ),
}

