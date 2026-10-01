import { describe, it, expect } from 'vitest';
import { CAPABILITY_VISION_UNSUPPORTED, isVisionCapabilityError } from '../classify.js';

describe('isVisionCapabilityError', () => {
  it('classifies vision-capability 400s by message keywords', () => {
    expect(
      isVisionCapabilityError({
        statusCode: 400,
        message: 'Invalid content type. image_url is only supported by vision models.',
      }),
    ).toBe(true);
    expect(
      isVisionCapabilityError({
        statusCode: 400,
        message: 'This model does not support image input.',
      }),
    ).toBe(true);
    expect(
      isVisionCapabilityError({ statusCode: 400, message: 'Unsupported input modality: image' }),
    ).toBe(true);
    expect(
      isVisionCapabilityError({ statusCode: 400, message: 'Images are not supported by this model' }),
    ).toBe(true);
  });

  it('classifies by structured details when the message alone is generic', () => {
    expect(
      isVisionCapabilityError({
        statusCode: 400,
        message: 'HTTP 400: Bad Request',
        details: { error: { code: 'unsupported_modality', message: 'image modality not allowed' } },
      }),
    ).toBe(true);
  });

  it('rejects non-400 status codes (网络/鉴权/限流一律不反写)', () => {
    expect(isVisionCapabilityError({ statusCode: 401, message: 'image ... not supported' })).toBe(false);
    expect(isVisionCapabilityError({ statusCode: 403, message: 'Invalid content type' })).toBe(false);
    expect(isVisionCapabilityError({ statusCode: 429, message: 'Rate limited: image requests' })).toBe(false);
    expect(isVisionCapabilityError({ statusCode: 502, message: 'Unsupported input modality' })).toBe(false);
  });

  it('rejects unrelated 400s (防止把普通参数错误误记成"不支持图片")', () => {
    expect(isVisionCapabilityError({ statusCode: 400, message: 'max_tokens must be at least 1' })).toBe(false);
    expect(isVisionCapabilityError({ statusCode: 400, message: 'Invalid request: missing field role' })).toBe(false);
    expect(isVisionCapabilityError({ statusCode: 400, message: 'Context length exceeded' })).toBe(false);
  });

  it('exposes the stable error code constant', () => {
    expect(CAPABILITY_VISION_UNSUPPORTED).toBe('capability_vision_unsupported');
  });
});
