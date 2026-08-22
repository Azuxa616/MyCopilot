// SkillsPage - Skill list with create + delete.
// Directory-sourced skills are read-only: delete disabled, show a "Directory" badge.

import { useState, useEffect, useCallback, useRef } from 'react'
import type { SkillMeta, CreateSkillParams, SkillDetail, UpdateSkillParams } from '@my-copilot/shared'
import { api } from '../../api'
import { importSkillZip, getSkillFile } from '../../api/real'
import SkillFormModal from '../../components/SkillFormModal'
import { Badge } from '../../components/common/Badge'
import { showMessageAlert } from '../../components/common/Alert/alertUtils'

// ─── Source badge ───

const sourceColorClass: Record<NonNullable<SkillMeta['source']>, string> = {
  upload: 'bg-blue-100 text-blue-700',
  directory: 'bg-gray-100 text-gray-600',
  plugin: 'bg-purple-100 text-purple-700',
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
  const [editingSkill, setEditingSkill] = useState<SkillDetail | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null)
  const [filePreview, setFilePreview] = useState<{ path: string; content: string } | null>(null)

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

  const handleEdit = async (skill: SkillMeta) => {
    try {
      const detail = await api.getSkill(skill.id)
      setEditingSkill(detail)
      setIsModalOpen(true)
    } catch (error) {
      console.error('Failed to load skill:', error)
      showMessageAlert.error('加载 Skill 失败')
    }
  }

  const handleModalUpdate = async (id: string, params: UpdateSkillParams) => {
    try {
      const updated = await api.updateSkill(id, params)
      setSkills((prev) => prev.map((s) => (s.id === id ? { ...s, ...updated } : s)))
      showMessageAlert.success('Skill 已更新')
    } catch (error) {
      console.error('Failed to update skill:', error)
      showMessageAlert.error('更新 Skill 失败')
    }
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 允许重复选择同一文件
    if (!file) return
    setIsImporting(true)
    try {
      await importSkillZip(file)
      showMessageAlert.success('Skill 导入成功')
      await loadSkills()
    } catch (error) {
      console.error('Failed to import skill:', error)
      showMessageAlert.error(error instanceof Error ? error.message : '导入 Skill 失败')
    } finally {
      setIsImporting(false)
    }
  }

  const handlePreviewFile = async (skillId: string, path: string) => {
    try {
      const data = await getSkillFile(skillId, path)
      setFilePreview(data)
    } catch (error) {
      console.error('Failed to load skill file:', error)
      showMessageAlert.error('加载文件失败')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-text-primary">技能管理</h2>
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            onChange={handleImportFile}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="px-4 py-2 bg-bg-secondary text-text-primary border border-border-base rounded-lg hover:border-primary-400 transition-colors text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isImporting ? '导入中...' : '导入 ZIP'}
          </button>
          <button
            onClick={handleCreate}
            className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors text-sm font-medium"
          >
            + 新建 Skill
          </button>
        </div>
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
               <div key={skill.id} className="flex flex-col gap-2">
                 <div className="flex items-center justify-between p-4 bg-bg-secondary border border-border-base rounded-lg hover:border-primary-400 transition-colors">
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-text-primary">
                      {skill.name}
                    </span>
                    <SourceBadge source={skill.source} />
                    {(skill.fileCount ?? 0) > 0 && (
                      <button
                        onClick={() =>
                          setExpandedSkill(expandedSkill === skill.id ? null : skill.id)
                        }
                        className="text-xs text-primary-600 hover:text-primary-700 underline underline-offset-2"
                      >
                        {skill.fileCount} 个附属文件
                      </button>
                    )}
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
                    onClick={() => handleEdit(skill)}
                    disabled={isDirectory}
                    className="px-3 py-1.5 text-xs bg-bg-elevated border border-border-base text-text-primary rounded-lg hover:border-primary-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => handleDelete(skill)}
                    disabled={isDirectory}
                    className="px-3 py-1.5 text-xs bg-error-50 border border-error-200 text-error-600 rounded-lg hover:bg-error-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    删除
                  </button>
                </div>
              </div>
              {expandedSkill === skill.id && (
                <SkillFilesPanel skillId={skill.id} onOpen={handlePreviewFile} />
              )}
            </div>
            )
          })}
        </div>
      )}

      <SkillFormModal
        open={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setEditingSkill(null)
        }}
        onSave={handleModalSave}
        editing={editingSkill}
        onUpdate={handleModalUpdate}
      />

      {filePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="flex flex-col gap-3 max-w-2xl w-full max-h-[70vh] bg-bg-elevated border border-border-base rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-mono font-medium text-text-primary truncate">
                {filePreview.path}
              </span>
              <button
                onClick={() => setFilePreview(null)}
                className="px-3 py-1 text-xs bg-bg-secondary border border-border-base rounded-lg hover:bg-bg-hover transition-colors"
              >
                关闭
              </button>
            </div>
            <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap overflow-auto">
              {filePreview.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

function SkillFilesPanel({
  skillId,
  onOpen,
}: {
  skillId: string
  onOpen: (skillId: string, path: string) => void
}) {
  const [files, setFiles] = useState<{ path: string; size: number }[] | null>(null)

  useEffect(() => {
    let active = true
    api
      .getSkill(skillId)
      .then((detail) => {
        if (active) setFiles(detail.files ?? [])
      })
      .catch(() => {
        if (active) setFiles([])
      })
    return () => {
      active = false
    }
  }, [skillId])

  if (files === null) {
    return <div className="text-xs text-text-tertiary pl-4">加载附属文件...</div>
  }
  if (files.length === 0) {
    return <div className="text-xs text-text-tertiary pl-4">无附属文件</div>
  }
  return (
    <div className="flex flex-col gap-1 pl-4 py-2 border-l-2 border-border-base">
      {files.map((f) => (
        <button
          key={f.path}
          onClick={() => onOpen(skillId, f.path)}
          className="text-left text-xs font-mono text-text-secondary hover:text-primary-600 transition-colors truncate"
        >
          {f.path} <span className="text-text-tertiary">({f.size} B)</span>
        </button>
      ))}
    </div>
  )
}
