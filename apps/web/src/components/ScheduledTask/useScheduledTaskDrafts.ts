import { useEffect, useState } from 'react';
import type { Model, SessionSummary, SkillMeta } from '@my-copilot/shared';
import { api } from '../../api';
import { NEW_SESSION_SENTINEL, useSessionStore } from '../../store/sessionStore';

const EMPTY_DRAFTS = Object.freeze([]);
export function useScheduledTaskDrafts(sessionId: string) {
  const loadDrafts = useSessionStore((state) => state.loadScheduledTaskDrafts);
  const drafts = useSessionStore((state) => state.scheduledTaskDrafts[sessionId] ?? EMPTY_DRAFTS);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  useEffect(() => {
    if (!sessionId || sessionId === NEW_SESSION_SENTINEL) return;
    void loadDrafts(sessionId);
    void Promise.all([api.fetchSessionSummaries(), api.fetchAllModels(), api.fetchSkills()]).then(([s, m, k]) => {
      setSessions(s); setModels(m.filter((model) => model.enabled)); setSkills(k.filter((skill) => skill.enabled));
    });
  }, [sessionId, loadDrafts]);
  return { drafts: drafts.filter((draft) => draft.status === 'pending'), sessions, models, skills };
}
