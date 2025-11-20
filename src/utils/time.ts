/**
 * 时间工具函数
 */

/**
 * 获取当前时间戳（毫秒）
 */
export function getCurrentTimestamp(): number {
  return Date.now();
}

/**
 * 获取当前时间戳（秒）
 */
export function getCurrentTimestampSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * 获取当前时间的 Date 对象
 */
export function getCurrentDate(): Date {
  return new Date();
}

/**
 * 格式化时间为字符串
 * @param timestamp 时间戳（毫秒）
 * @param format 格式类型：'date' | 'time' | 'datetime' | 'iso'
 */
export function formatTime(
  timestamp: number,
  format: 'date' | 'time' | 'datetime' | 'iso' = 'datetime'
): string {
  const date = new Date(timestamp);

  switch (format) {
    case 'date':
      return date.toLocaleDateString('zh-CN');
    case 'time':
      return date.toLocaleTimeString('zh-CN');
    case 'datetime':
      return date.toLocaleString('zh-CN');
    case 'iso':
      return date.toISOString();
    default:
      return date.toLocaleString('zh-CN');
  }
}

/**
 * 格式化时间为自定义格式
 * @param timestamp 时间戳（毫秒）
 * @param format 格式字符串，例如：'YYYY-MM-DD HH:mm:ss'
 */
export function formatTimeCustom(timestamp: number, format: string = 'YYYY-MM-DD HH:mm:ss'): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return format
    .replace('YYYY', String(year))
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
}

/**
 * 获取相对时间描述（例如：刚刚、1分钟前、1小时前）
 * @param timestamp 时间戳（毫秒）
 */
export function getRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return '刚刚';
  } else if (minutes < 60) {
    return `${minutes}分钟前`;
  } else if (hours < 24) {
    return `${hours}小时前`;
  } else if (days < 7) {
    return `${days}天前`;
  } else {
    return formatTime(timestamp, 'date');
  }
}

/**
 * 判断是否为今天
 * @param timestamp 时间戳（毫秒）
 */
export function isToday(timestamp: number): boolean {
  const today = new Date();
  const date = new Date(timestamp);
  return (
    today.getFullYear() === date.getFullYear() &&
    today.getMonth() === date.getMonth() &&
    today.getDate() === date.getDate()
  );
}


/** 
* 判断单日时间段(上午/下午/晚上/凌晨)
* @param timestamp 时间戳（毫秒）
*/ 

export function getTimePeriod(timestamp: number): '上午' | '下午' | '晚上' | '凌晨' {
  const hours = new Date(timestamp).getHours();
  if (hours < 12) {
    return '上午';
  } else if (hours < 18) {
    return '下午';
  } else if (hours < 24) {
    return '晚上';
  } else {
    return '凌晨';
  }
}