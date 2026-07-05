export const headingClasses = [
  'text-[32px] font-bold text-text-primary mb-3 mt-4', // h1
  'text-[28px] font-bold text-text-primary mb-2.5 mt-3', // h2
  'text-[24px] font-bold text-text-primary mb-2 mt-2.5', // h3
  'text-[20px] font-semibold text-text-primary mb-1.5 mt-2', // h4
  'text-[18px] font-semibold text-text-secondary mb-1.5 mt-1.5', // h5
  'text-[17px] font-semibold text-text-secondary mb-1 mt-1.5', // h6
] as const

export const languageAliasMap: Record<string, string> = {
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

