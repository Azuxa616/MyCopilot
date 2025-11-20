import Asider from '../components/Asider'
export default function MainView() {
    return (
        <div className="flex h-screen w-screen bg-bg-primary">
            <aside className="flex h-full max-w-70 border-r border-border-base">
                <Asider />
            </aside>
            <main className="flex-1 bg-bg-elevated text-text-primary p-6">
                <h1 className="text-2xl font-semibold mb-4 text-text-primary">主内容区</h1>
                <p className="text-text-secondary">这里是主内容区域，使用护眼配色方案。</p>
            </main>
        </div>

    )
}
