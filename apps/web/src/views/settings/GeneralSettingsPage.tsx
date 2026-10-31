import { useEffect, useState } from 'react'
import { api } from '../../api'
import Switch from '../../components/common/Switch'
import { showMessageAlert } from '../../components/common/Alert/alertUtils'

export function GeneralSettingsPage() {
  const [enabled, setEnabled] = useState(false)
  const [seconds, setSeconds] = useState('300')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void api.fetchAskUserSettings().then((settings) => {
      setEnabled(settings.timeoutMs !== null)
      if (settings.timeoutMs !== null) setSeconds(String(Math.floor(settings.timeoutMs / 1000)))
    }).catch(() => {
      showMessageAlert.error('加载问答卡片设置失败')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const duration = Number(seconds)
  const valid = !enabled || (Number.isInteger(duration) && duration >= 1 && duration <= 604800)

  const save = async () => {
    if (!valid) return
    setSaving(true)
    try {
      await api.saveAskUserSettings(enabled ? duration * 1000 : null)
      showMessageAlert.success('问答卡片超时设置已保存')
    } catch {
      showMessageAlert.error('保存问答卡片设置失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="flex flex-col gap-5" aria-labelledby="general-settings-title">
      <div>
        <h1 id="general-settings-title" className="text-xl font-semibold text-text-primary">通用设置</h1>
        <p className="mt-1 text-sm text-text-tertiary">调整问答卡片的人机交互行为。</p>
      </div>
      <div className="rounded-lg border border-border-base bg-bg-primary p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium text-text-primary">问答卡片等待超时</h2>
            <p className="mt-1 text-xs text-text-tertiary">关闭后，Agent 会等待你回答，不会因页面刷新而中止。</p>
          </div>
          <Switch value={enabled} onValueChange={setEnabled} />
        </div>
        <label className="flex flex-col gap-1.5 text-sm text-text-primary">
          <span>超时时间（秒）</span>
          <input
            type="number"
            min={1}
            max={604800}
            step={1}
            value={seconds}
            disabled={!enabled || loading}
            onChange={(event) => setSeconds(event.target.value)}
            className="w-48 rounded-lg border border-border-base bg-bg-elevated px-3 py-2 text-sm focus:border-primary-500 focus:outline-none disabled:opacity-50"
          />
          {!valid && <span className="text-xs text-error-600">请输入 1 至 604800 之间的整数秒数。</span>}
        </label>
        <div>
          <button
            type="button"
            disabled={!valid || loading || saving}
            onClick={() => { void save() }}
            className="rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存设置'}
          </button>
        </div>
      </div>
    </section>
  )
}
