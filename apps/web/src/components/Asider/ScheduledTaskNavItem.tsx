import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock } from 'lucide-react';
import { api } from '../../api';

export function ScheduledTaskNavItem({ isCollapsed }: { isCollapsed: boolean }) {
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try { const count = await api.fetchScheduledTaskRunUnreadCount(); if (active) setUnread(count); }
      catch { /* 保留上次未读数，避免轮询错误打断导航 */ }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <button onClick={() => navigate('/scheduled')} className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'justify-start gap-2'} ${isCollapsed ? 'px-2' : 'px-4'} py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors`} title={isCollapsed ? '定时任务' : undefined}>
    <CalendarClock className="w-5 h-5 shrink-0" />{!isCollapsed && <span>定时任务</span>}{!isCollapsed && unread > 0 ? <span className="ml-auto rounded-full bg-primary-500 px-2 py-0.5 text-xs text-white">{unread}</span> : null}
  </button>;
}
