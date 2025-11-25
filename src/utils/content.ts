/**
 * 计算字符串中换行符的数量
 * @param str 输入的字符串
 * @returns 换行符的数量
 * @example
 * countNewlines("123\n456\n\n789") // 返回 3
 */
export function countNewlines(str: string): number {
  if (!str) {
    return 0;
  }
  // 使用 match 方法匹配所有换行符
  const matches = str.match(/\n/g);
  return matches ? matches.length : 0;
}

/**
 * 计算 Markdown 格式的 AI 回复消息的高度（估算值）
 * 基于 MarkdownRenderer 组件的样式设置
 * 
 * @param markdownContent Markdown 格式的内容
 * @returns 估算的高度（像素）
 * 
 * @example
 * estimateMarkdownHeight("# 标题\n\n这是一段内容") // 返回估算高度
 */
export function estimateMarkdownHeight(markdownContent: string): number {
  if (!markdownContent || !markdownContent.trim()) {
    return 0;
  }

  // MessageCard 助手消息容器的 padding: px-4 py-2 = 上下各 8px
  const messageCardPadding = 8 * 2; // 16px

  // MarkdownRenderer 外层容器: gap-2 = 8px 元素间距
  const elementGap = 8;

  // 基础样式常量（基于 MarkdownRenderer 组件）
  const paragraphFontSize = 15; // text-[15px]
  const lineHeight = 1.625; // leading-relaxed
  const paragraphLineHeight = paragraphFontSize * lineHeight; // ≈ 24px

  // 元素间距常量
  const paragraphMarginBottom = 12; // mb-3
  const headingMargins = {
    h1: { top: 16, bottom: 12 }, // mt-4 mb-3
    h2: { top: 12, bottom: 10 }, // mt-3 mb-2.5
    h3: { top: 10, bottom: 8 }, // mt-2.5 mb-2
    h4: { top: 8, bottom: 6 }, // mt-2 mb-1.5
    h5: { top: 6, bottom: 6 }, // mt-1.5 mb-1.5
    h6: { top: 6, bottom: 4 }, // mt-1.5 mb-1
  };
  const codeBlockMargin = 16; // my-4
  const blockquoteMargin = 12; // my-3
  const hrMargin = 16; // my-4
  const listMarginBottom = 12; // mb-3
  const tableMargin = 16; // my-4

  let totalHeight = messageCardPadding;
  const lines = markdownContent.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // 跳过空行
    if (!line) {
      i++;
      continue;
    }

    // 代码块检测（``` 开始和结束）
    if (line.startsWith('```')) {
      let codeLines = 0;
      i++;
      
      // 查找代码块结束
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines++;
        i++;
      }
      
      if (i < lines.length) {
        i++; // 跳过结束标记
      }

      // 代码块高度 = 头部(约32px) + 内容区域 + 边距
      const codeBlockHeaderHeight = 32; // 语言标签和复制按钮
      const codeContentHeight = Math.max(codeLines * 21, 40); // 最小40px
      const codeBlockHeight = codeBlockHeaderHeight + codeContentHeight + codeBlockMargin * 2;
      totalHeight += codeBlockHeight + elementGap;
      continue;
    }

    // 标题检测
    if (line.startsWith('# ')) {
      const text = line.slice(2).trim();
      const textHeight = Math.ceil(text.length / 40) * 32; // h1: 32px 字体
      totalHeight += textHeight + headingMargins.h1.top + headingMargins.h1.bottom + elementGap;
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      const text = line.slice(3).trim();
      const textHeight = Math.ceil(text.length / 45) * 28; // h2: 28px 字体
      totalHeight += textHeight + headingMargins.h2.top + headingMargins.h2.bottom + elementGap;
      i++;
      continue;
    }
    if (line.startsWith('### ')) {
      const text = line.slice(4).trim();
      const textHeight = Math.ceil(text.length / 50) * 24; // h3: 24px 字体
      totalHeight += textHeight + headingMargins.h3.top + headingMargins.h3.bottom + elementGap;
      i++;
      continue;
    }
    if (line.startsWith('#### ')) {
      const text = line.slice(5).trim();
      const textHeight = Math.ceil(text.length / 55) * 20; // h4: 20px 字体
      totalHeight += textHeight + headingMargins.h4.top + headingMargins.h4.bottom + elementGap;
      i++;
      continue;
    }
    if (line.startsWith('##### ')) {
      const text = line.slice(6).trim();
      const textHeight = Math.ceil(text.length / 60) * 18; // h5: 18px 字体
      totalHeight += textHeight + headingMargins.h5.top + headingMargins.h5.bottom + elementGap;
      i++;
      continue;
    }
    if (line.startsWith('###### ')) {
      const text = line.slice(7).trim();
      const textHeight = Math.ceil(text.length / 65) * 17; // h6: 17px 字体
      totalHeight += textHeight + headingMargins.h6.top + headingMargins.h6.bottom + elementGap;
      i++;
      continue;
    }

    // 引用检测
    if (line.startsWith('> ')) {
      const quoteText = line.slice(2).trim();
      const quoteLines = Math.ceil(quoteText.length / 60); // 估算每行60字符
      const quoteHeight = quoteLines * 21 + 16; // 内容 + padding (py-2 = 8px * 2)
      totalHeight += quoteHeight + blockquoteMargin * 2 + elementGap;
      i++;
      continue;
    }

    // 分隔线检测
    if (line.match(/^[-*_]{3,}$/)) {
      totalHeight += 1 + hrMargin * 2 + elementGap; // 1px 线 + 边距
      i++;
      continue;
    }

    // 列表项检测
    if (line.match(/^[-*+]\s/) || line.match(/^\d+\.\s/)) {
      const listText = line.replace(/^[-*+]\s/, '').replace(/^\d+\.\s/, '').trim();
      const listLines = Math.ceil(listText.length / 60);
      const listItemHeight = listLines * paragraphLineHeight;
      totalHeight += listItemHeight + 2; // mb-0.5 = 2px
      
      // 检查是否是列表的最后一项
      let isLastListItem = true;
      let nextIndex = i + 1;
      while (nextIndex < lines.length && !lines[nextIndex].trim()) {
        nextIndex++;
      }
      if (nextIndex < lines.length) {
        const nextLine = lines[nextIndex].trim();
        isLastListItem = !(nextLine.match(/^[-*+]\s/) || nextLine.match(/^\d+\.\s/));
      }
      
      if (isLastListItem) {
        totalHeight += listMarginBottom + elementGap;
      }
      i++;
      continue;
    }

    // 表格检测（简单检测）
    if (line.includes('|') && line.split('|').length >= 3) {
      // 估算表格高度：表头 + 数据行
      let tableRows = 1; // 表头
      let j = i + 1;
      while (j < lines.length && lines[j].trim().includes('|') && !lines[j].trim().match(/^[-|: ]+$/)) {
        tableRows++;
        j++;
      }
      const tableHeight = tableRows * 40 + tableMargin * 2; // 每行约40px
      totalHeight += tableHeight + elementGap;
      i = j;
      continue;
    }

    // 普通段落
    const paragraphLines = Math.ceil(line.length / 70); // 估算每行70字符（考虑容器宽度）
    const paragraphHeight = paragraphLines * paragraphLineHeight;
    totalHeight += paragraphHeight + paragraphMarginBottom + elementGap;
    i++;
  }

  // 添加最后一个元素的底部间距
  if (totalHeight > messageCardPadding) {
    totalHeight -= elementGap; // 移除最后一个元素的 gap
  }

  return Math.max(totalHeight, 50); // 最小高度 50px
}

