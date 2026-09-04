import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SkillFormModal from './SkillFormModal';
import type { SkillDetail } from '@my-copilot/shared';

afterEach(() => {
  cleanup();
});

const detail: SkillDetail = {
  id: 's1',
  name: 'OldName',
  description: 'Old desc',
  content: '# old body',
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
  source: 'upload',
};

describe('SkillFormModal edit mode', () => {
  it('prefills fields from the editing skill and shows edit title', () => {
    render(
      <SkillFormModal open onClose={vi.fn()} onSave={vi.fn()} editing={detail} onUpdate={vi.fn()} />,
    );
    expect(screen.getByDisplayValue('OldName')).toBeTruthy();
    expect(screen.getByDisplayValue('Old desc')).toBeTruthy();
    expect(screen.getByText('编辑 Skill')).toBeTruthy();
  });

  it('submits UpdateSkillParams via onUpdate in edit mode (not onSave)', () => {
    const onSave = vi.fn();
    const onUpdate = vi.fn();
    render(
      <SkillFormModal open onClose={vi.fn()} onSave={onSave} editing={detail} onUpdate={onUpdate} />,
    );

    fireEvent.change(screen.getByDisplayValue('OldName'), { target: { value: 'NewName' } });
    fireEvent.click(screen.getByText('保存'));

    expect(onUpdate).toHaveBeenCalledWith('s1', {
      name: 'NewName',
      description: 'Old desc',
      body: '# old body',
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('create mode: title 新建 Skill, button 创建, calls onSave with minimal input', () => {
    const onSave = vi.fn();
    const onUpdate = vi.fn();
    render(
      <SkillFormModal open onClose={vi.fn()} onSave={onSave} editing={null} onUpdate={onUpdate} />,
    );

    expect(screen.getByText('新建 Skill')).toBeTruthy();
    expect(screen.getByText('创建')).toBeTruthy();

    // Fill name and description
    fireEvent.change(screen.getByPlaceholderText('例如：my-skill'), { target: { value: 'TestName' } });
    fireEvent.change(screen.getByPlaceholderText('Skill 用途描述'), { target: { value: 'TestDesc' } });

    // Click paste button to show textarea
    fireEvent.click(screen.getByText('粘贴文本'));

    // Fill content using direct userEvent-like approach
    const contentField = screen.getAllByRole('textbox').find(el => el.className.includes('font-mono'));
    expect(contentField).toBeTruthy();
    fireEvent.change(contentField!, { target: { value: 'TestBody' } });

    // Submit
    fireEvent.click(screen.getByText('创建'));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'TestName', description: 'TestDesc', body: 'TestBody' }),
    );
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('create mode: template chip fills paste content and frontmatter fields', () => {
    render(
      <SkillFormModal open onClose={vi.fn()} onSave={vi.fn()} editing={null} onUpdate={vi.fn()} />,
    );

    fireEvent.click(screen.getByText('代码评审'));

    const textarea = screen
      .getAllByRole('textbox')
      .find((el) => el.className.includes('font-mono')) as HTMLTextAreaElement;
    expect(textarea.value).toContain('name: code-review');
    expect((screen.getByDisplayValue('code-review') as HTMLInputElement).value).toBe('code-review');
  });
});