// SkillsPage - Skill list with create + delete.
// Directory-sourced skills are read-only: delete disabled, show a "Directory" badge.

import { useState, useEffect, useCallback } from 'react'
import type { SkillMeta, CreateSkillParams } from '@my-copilot/shared'
import { api } from '../../api'
import SkillFormModal from '../../components/SkillFormModal'
import { Badge } from '../../components/common/Badge'
import { showMessageAlert } from '../../components/common/Alert/alertUtils'

// ─── Source badge ───

const sourceColorClass: Record<NonNullable<SkillMeta['source']>, string> = {
  upload: 'bg-blue-100 text-blue-700',
  directory: 'bg-gray-100 text-gray-600',
}

function SourceBadge({ source }: { source: SkillMeta['source'] }) {
  if (!source) return null
  return <Badge colorClass={sourceColorClass[source]}>{source}</Badge>
}

// ─── Page ───

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillMeta[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const loadSkills = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await api.fetchSkills()
      setSkills(data)
    } catch (error) {
      console.error('Failed to load skills:', error)
      showMessageAlert.error('加载 Skills 失败')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSkills()
  }, [loadSkills])

  const handleCreate = () => {
    setIsModalOpen(true)
  }

  const handleDelete = async (skill: SkillMeta) => {
    if (!confirm(`确定要删除技能「${skill.name}」吗？此操作不可恢复。`)) return
    try {
      await api.deleteSkill(skill.id)
      setSkills((prev) => prev.filter((s) => s.id !== skill.id))
      showMessageAlert.success('Skill 已删除')
    } catch (error) {
      console.error('Failed to delete skill:', error)
      showMessageAlert.error('删除 Skill 失败')
    }
  }

  const handleModalSave = async (params: CreateSkillParams) => {
    try {
      const created = await api.createSkill(params)
      setSkills((prev) => [...prev, created])
      showMessageAlert.success('Skill 创建成功')
    } catch (error) {
      console.error('Failed to save skill:', error)
      showMessageAlert.error('保存 Skill 失败')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-text-primary">技能管理</h2>
        <button
          onClick={handleCreate}
          className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm font-medium"
        >
          + 新建 Skill
        </button>
      </div>

      {/* Skill list */}
      {isLoading ? (
        <div className="text-sm text-text-secondary">加载中...</div>
      ) : skills.length === 0 ? (
        <div className="text-sm text-text-secondary">
          暂无 Skill，点击上方按钮创建
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {skills.map((skill) => {
            const isDirectory = skill.source === 'directory'
            return (
              <div
                key={skill.id}
                className="flex items-center justify-between p-4 bg-bg-secondary border border-border-base rounded-lg hover:border-primary-400 transition-colors"
              >
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-text-primary">
                      {skill.name}
                    </span>
                    <SourceBadge source={skill.source} />
                    {isDirectory && (
                      <span className="text-xs text-text-tertiary italic">
                        （只读）
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-text-secondary truncate">
                    {skill.description || '—'}
                  </span>
                  {skill.filePath && (
                    <span className="text-xs text-text-tertiary font-mono truncate">
                      {skill.filePath}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0 pl-4">
                  <button
                    onClick={() => handleDelete(skill)}
                    disabled={isDirectory}
                    className="px-3 py-1.5 text-xs bg-error-50 border border-error-200 text-error-600 rounded-lg hover:bg-error-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    删除
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <SkillFormModal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleModalSave}
      />
    </div>
  )
}
