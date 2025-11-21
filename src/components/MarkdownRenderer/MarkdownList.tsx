import type { ReactNode } from 'react'
import { renderInlineElements } from './markdownUtils'

interface MarkdownListProps {
  items: string[]
  ordered?: boolean
}

export default function MarkdownList({ items, ordered = false }: MarkdownListProps): ReactNode {
  if (items.length === 0) {
    return null
  }

  const ListTag = ordered ? 'ol' : 'ul'
  const listClassName = ordered ? 'mb-3 ml-5 list-decimal' : 'mb-3 ml-5 list-disc'

  return (
    <ListTag className={listClassName}>
      {items.map((item, index) => (
        <li key={index} className="mb-0.5 text-text-primary">
          {renderInlineElements(item)}
        </li>
      ))}
    </ListTag>
  )
}


