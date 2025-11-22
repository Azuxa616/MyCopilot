import { languageAliasMap } from './constants'

/**
 * 合并 classNames
 */
export const cx = (...classNames: Array<string | undefined | null | false>) =>
  classNames.filter(Boolean).join(' ')

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

