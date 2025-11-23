import { useEffect, useRef } from 'react'
import MainView from './views/MainView'
import { useChatStore } from './store/chatStore'
import { useUserStore } from './store/userStore'
import { api } from './api'
import AlertContainer from './components/common/Alert'
import './App.css'

function App() {
  const loadChatSummaries = useChatStore((state) => state.loadChatSummaries)
  const setUser = useUserStore((state) => state.setUser)
  const createChat = useChatStore((state) => state.createChat)
  const setSelectedChatId = useChatStore((state) => state.setSelectedChatId)
  
  // 使用 ref 防止重复初始化（React Strict Mode 会执行两次）
  const hasInitialized = useRef(false)
  
  useEffect(() => {
    // 防止重复初始化
    if (hasInitialized.current) { 
      return
    }
    hasInitialized.current = true
    
    // 初始化聊天列表和用户信息
    const initApp = async () => {
      try {
        await Promise.all([
          loadChatSummaries(),
          api.fetchUser().then(setUser),
        ])
        
        // 初始化完成后，始终创建并展示新对话
        const newChat = createChat({});
        setSelectedChatId(newChat.id);
      } catch (error) {
        console.error('初始化应用失败:', error)
        // 即使初始化失败，也创建新对话
        const newChat = createChat({});
        setSelectedChatId(newChat.id);
      }
    }
    
    initApp()
  }, []) // 移除依赖项，只在组件挂载时执行一次

  return (
    <>
      <AlertContainer />
      <MainView />
    </>
  )
}

export default App
