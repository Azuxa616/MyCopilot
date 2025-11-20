export default function Asider() {
  return (
    <div className="w-64 h-full bg-bg-secondary border border-border-base flex flex-col">
        {/* 新建对话按钮 */}
        <button 
          title="新建对话" 
          className="m-2 px-4 py-2 bg-primary-500 hover:bg-primary-600 text-text-inverse rounded-lg transition-colors"
        >
          新建对话
        </button>
        <nav className="flex-1 overflow-y-auto">

        </nav>
    </div>
  )
}
