interface CodeBlockProps {
  language: string
  children: string
  className?: string
}

/**
 * 支持的语言列表，用于验证和映射
 */
const SUPPORTED_LANGUAGES = [
  'javascript',
  'typescript',
  'python',
  'java',
  'cpp',
  'csharp',
  'php',
  'ruby',
  'go',
  'rust',
  'swift',
  'kotlin',
  'sql',
  'json',
  'yaml',
  'markdown',
  'bash',
  'css',
  'scss',
  'html',
  'jsx',
  'text',
]

/**
 * 语言别名映射
 * 将常见的语言别名映射到标准语言名称
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  sh: 'bash',
  shell: 'bash',
  yml: 'yaml',
  htm: 'html',
}

export default function CodeBlock({ language, children, className = '' }: CodeBlockProps) {
  const normalizedLang = language.toLowerCase().trim()
  const mappedLang = LANGUAGE_ALIASES[normalizedLang] ?? normalizedLang
  const finalLang = SUPPORTED_LANGUAGES.includes(mappedLang) ? mappedLang : 'text'

  const lines = children.replace(/\n+$/, '').split('\n')

  return (
    <div
      className={`my-4 rounded-lg overflow-hidden bg-[#1e1e1e] text-[#d4d4d4] text-[13px] leading-relaxed ${className}`}
      data-language={finalLang}
    >
      <div className="flex items-center justify-between px-3 py-1 text-[11px] text-text-tertiary bg-[#151515]">
        <span className="uppercase tracking-wide">{finalLang}</span>
      </div>
      <pre className="m-0 max-h-[480px] overflow-x-auto overflow-y-auto px-3 py-2 font-mono text-[13px] leading-[1.5]">
        {lines.map((line, index) => (
          <div key={index} className="flex">
            <span className="mr-4 w-8 select-none text-right text-xs text-text-tertiary">
              {index + 1}
            </span>
            <span className="whitespace-pre-wrap break-words">{line || '\u00A0'}</span>
          </div>
        ))}
      </pre>
    </div>
  )
}


