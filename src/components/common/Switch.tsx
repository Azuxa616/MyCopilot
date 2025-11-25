// Switch - 开关组件
// 用于切换布尔值的开关控件

interface SwitchProps {
    value: boolean;
    onValueChange?: (value: boolean) => void;
}

export default function Switch({ value, onValueChange }: SwitchProps) {
    const handleClick = () => {
        onValueChange?.(!value);
    };

    return (
        <button
            type="button"
            title={value ? '开启' : '关闭'}
            onClick={handleClick}
            className={`w-11 h-6 rounded-full relative transition-colors duration-300 focus:outline-none focus:ring-1   ${
                value ? 'bg-success' : 'bg-gray-300'
            }`}
        >
            <div
                className={`w-5 h-5 bg-bg-elevated rounded-full absolute top-0.5 transition-transform duration-300 shadow-sm ${
                    value ? 'translate-x-5.5' : 'translate-x-0.5'
                }`}
            />
        </button>
    )
}
