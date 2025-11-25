import { useEffect, useRef } from 'react'
import MainView from './views/MainView'
import { useChatStore } from './store/chatStore'
import { useUserStore } from './store/userStore'
import { api } from './api'
import AlertContainer from './components/common/Alert'
import './App.css'
import { useConfigStore } from './store/configStore'
import { showMessageAlert } from './components/common/Alert/alertUtils'

function App() {
  const loadChatSummaries = useChatStore((state) => state.loadChatSummaries)
  const setUser = useUserStore((state) => state.setUser)
  const createChat = useChatStore((state) => state.createChat)
  const setSelectedChatId = useChatStore((state) => state.setSelectedChatId)
  const apiMode = useConfigStore((state) => state.apiMode)
  // 使用 ref 防止重复初始化（React Strict Mode 会执行两次）
  const hasInitialized = useRef(false)

  useEffect(() => {
    // 防止重复初始化
    if (hasInitialized.current) {
      return
    }
    hasInitialized.current = true

    // 初始化聊天列表和用户信息
    const initAppMock = async () => {
      try {
        await Promise.all([
          loadChatSummaries(),
          api.fetchUser().then(setUser),
        ])

        // 初始化完成后，始终创建并展示新对话
        const newChat = createChat({});
        setSelectedChatId(newChat.id);
      } catch (error) {
        console.error('Mock模式初始化应用失败:', error)
        // 即使初始化失败，也创建新对话
        const newChat = createChat({});
        setSelectedChatId(newChat.id);
        showMessageAlert.error('Mock模式初始化应用失败:' + error)
      }
    }
    const initAppReal = async () => {
      try {
        // Real 模式下，聊天数据会从 localStorage 自动恢复（persist middleware）
        await new Promise(resolve => setTimeout(resolve, 0));
        
        // 加载用户信息
        await api.fetchUser().then(setUser);
        
        // 检查恢复后的数据
        const chatStore = useChatStore.getState();
        if (chatStore.chatSummaries.length === 0) {
          // 如果 localStorage 中没有数据，创建一个新对话
          const newChat = createChat({});
          setSelectedChatId(newChat.id);
        } else if (chatStore.selectedChatId) {
          // 如果有选中的聊天，确保它被正确设置
          setSelectedChatId(chatStore.selectedChatId);
        } else if (chatStore.chatSummaries.length > 0) {
          // 如果有聊天但没有选中，选中第一个
          setSelectedChatId(chatStore.chatSummaries[0].id);
        }
      } catch (error) {
        console.error('Real模式初始化应用失败:', error)
        showMessageAlert.error('Real模式初始化应用失败:' + error)
      }
    }
    if (apiMode === 'mock') {
      initAppMock()
    } else {
      initAppReal()
    }
  }, [createChat, loadChatSummaries, setSelectedChatId, setUser, apiMode])

  return (
    <>
      <AlertContainer />
      <MainView />
    </>
  )
}

export default App
