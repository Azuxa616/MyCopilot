import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyVisionLearningLoop } from '../learning.js';
import { setModelVisionCapability } from '../../repo/model.js';
import { ProviderError } from '../../llm/index.js';
import { CAPABILITY_VISION_UNSUPPORTED } from '../classify.js';

vi.mock('../../repo/model.js', () => ({
  setModelVisionCapability: vi.fn(),
}));

function capability400(): ProviderError {
  return new ProviderError(
    'OpenAI request failed: Invalid content type. image_url is only supported by vision models.',
    400,
    { error: { message: 'Invalid content type.' } },
    CAPABILITY_VISION_UNSUPPORTED,
  );
}

describe('applyVisionLearningLoop（学习闭环单点：仅降级，不升格）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const base = { modelId: 'm1', outboundHasImage: true };

  it('成功出站不再升格 yes（DeepSeek 静默降级实证：成功≠图片被感知）', () => {
    applyVisionLearningLoop({ ...base, result: { status: 'completed' } });
    applyVisionLearningLoop({ ...base, result: { status: 'length_limited' } });
    applyVisionLearningLoop({ ...base, result: { status: 'max_iterations' } });
    expect(setModelVisionCapability).not.toHaveBeenCalled();
  });

  it('能力性 400（errorCode）→ 反写 no', () => {
    applyVisionLearningLoop({
      ...base,
      result: { status: 'error', cause: capability400() },
    });
    expect(setModelVisionCapability).toHaveBeenCalledWith('m1', 'no', 'probe');
  });

  it('限流 429 不反写（网络/鉴权/限流一律不写）', () => {
    applyVisionLearningLoop({
      ...base,
      result: { status: 'error', cause: new ProviderError('Rate limited', 429) },
    });
    expect(setModelVisionCapability).not.toHaveBeenCalled();
  });

  it('400 但非能力性（无 errorCode）不反写', () => {
    applyVisionLearningLoop({
      ...base,
      result: { status: 'error', cause: new ProviderError('max_tokens must be at least 1', 400) },
    });
    expect(setModelVisionCapability).not.toHaveBeenCalled();
  });

  it('error 但 cause 非 ProviderError（stringify 后的字符串）不反写', () => {
    applyVisionLearningLoop({
      ...base,
      result: { status: 'error', cause: 'Error: something' },
    });
    expect(setModelVisionCapability).not.toHaveBeenCalled();
  });

  it('aborted 不反写；无图不反写', () => {
    applyVisionLearningLoop({
      ...base,
      result: { status: 'aborted' },
    });
    applyVisionLearningLoop({
      ...base,
      outboundHasImage: false,
      result: { status: 'completed' },
    });
    expect(setModelVisionCapability).not.toHaveBeenCalled();
  });
});
