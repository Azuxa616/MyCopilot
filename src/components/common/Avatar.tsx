
interface AvatarProps {
  src: string;
  alt: string;
  size?: number;
  className?: string;
}
export default function Avatar({ src, alt, size = 32, className = '' }: AvatarProps) {
  return (
    <img src={src} alt={alt} className={`w-${size} h-${size} rounded-full ${className}`} />
  )
}
