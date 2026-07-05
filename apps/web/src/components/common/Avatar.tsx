// Avatar - 头像组件
// 显示用户或AI的头像图片

interface AvatarProps {
  src: string;
  alt: string;
  size?: number;
  className?: string;
}
export default function Avatar({ src, alt, size = 12, className = '' }: AvatarProps) {

  // size 值对应 Tailwind 的间距单位：1 = 0.25rem (4px), 12 = 3rem (48px)
  const sizeInRem = size * 0.25;
  return (

    <img 
      src={src} 
      alt={alt} 
      className={`rounded-full ${className}`}
      style={{ width: `${sizeInRem}rem`, height: `${sizeInRem}rem` }}
    />
  )
}
