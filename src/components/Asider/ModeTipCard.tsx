export interface ModeTipCardProps {
  isMock: boolean;
}

export default function ModeTipCard({ isMock }: ModeTipCardProps) {
  return (
    <div className={`max-w-50 mx-auto m-10 w-full text-sm flex items-center justify-center border-dashed border-2 border-info rounded-lg p-2 px-3 bg-info-light text-info-dark ${isMock ? 'bg-info-light text-info-dark' : 'bg-success-light text-success-dark'}`}>
      {isMock 
        ? "当前处于Mock模式，所有数据均为本地Json数据，可在下方设置中切换Api模式。"
        : "当前处于真实API模式，所有数据从配置的LLM API获取，对话数据将保存在LocalStorage中。"
      }
    </div>
  )
}

