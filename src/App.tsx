import { useEffect } from 'react'
import MainView from './views/MainView'
import { useChatStore } from './store/chatStore'
import { useUserStore } from './store/userStore'
import { mockApi } from './utils/mockApi'
import './App.css'

function App() {
  const loadChatSummaries = useChatStore((state) => state.loadChatSummaries)
  const setUser = useUserStore((state) => state.setUser)

  useEffect(() => {
    // 初始化聊天列表和用户信息
    const initApp = async () => {
      try {
        await Promise.all([
          loadChatSummaries(),
          mockApi.getUser().then(setUser),
        ])
      } catch (error) {
        console.error('初始化应用失败:', error)
      }
    }

    initApp()
  }, [loadChatSummaries, setUser])

  return (
    <MainView />
  )
}

export default App
