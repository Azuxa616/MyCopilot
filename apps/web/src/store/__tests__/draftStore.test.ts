import { describe, it, expect, beforeEach } from 'vitest';
import { useDraftStore } from '../draftStore';

describe('draftStore', () => {
  beforeEach(() => {
    useDraftStore.setState({ pendingDraft: null });
  });

  it('setPendingDraft then consumePendingDraft returns value and clears', () => {
    useDraftStore.getState().setPendingDraft('hello');
    expect(useDraftStore.getState().consumePendingDraft()).toBe('hello');
    expect(useDraftStore.getState().pendingDraft).toBeNull();
    expect(useDraftStore.getState().consumePendingDraft()).toBeNull();
  });
});