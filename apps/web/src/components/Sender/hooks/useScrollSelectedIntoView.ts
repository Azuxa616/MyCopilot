// useScrollSelectedIntoView - 键盘导航滚动跟随
// 面板条目以 data-index 标记；selectedIndex 变化时把选中项滚入可视区
// （block: 'nearest'——已在可视区内时不滚动，避免列表抖动）。

import { useEffect } from 'react'
import type { RefObject } from 'react'

export function useScrollSelectedIntoView(
    listRef: RefObject<HTMLElement | null>,
    selectedIndex: number,
): void {
    useEffect(() => {
        const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`)
        el?.scrollIntoView({ block: 'nearest' })
    }, [listRef, selectedIndex])
}
