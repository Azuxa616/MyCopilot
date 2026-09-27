import { isValidElement, type ReactNode } from 'react'
import { languageAliasMap } from './constants'

/**
 * 合并 classNames
 */
export const cx = (...classNames: Array<string | undefined | null | false>) =>
  classNames.filter(Boolean).join(' ')

/**
 * 从 React children 中递归提取纯文本。
 * rehype/prism 管线可能把 code 块内容包进多层元素（span 等），
 * String()/join() 无法取出，必须递归收集字符串叶子。
 */
export function childrenToText(children: ReactNode): string {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(childrenToText).join('')
  if (isValidElement(children)) {
    const props = children.props as { children?: ReactNode }
    return childrenToText(props.children)
  }
  return ''
}

export const extractLanguage = (className?: string) => {
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

