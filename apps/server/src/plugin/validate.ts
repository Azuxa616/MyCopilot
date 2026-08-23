import { readFileSync } from 'node:fs';
import Ajv, { type AnySchema, type ErrorObject, type ValidateFunction } from 'ajv';

/**
 * 插件清单/生命周期事件的运行时校验。
 *
 * schema 采用 docs/rfc/schemas/ 的拷贝件（apps/server/src/plugin/schemas/），
 * 由 __tests__/validate.test.ts 的同步测试保证与 docs 原件逐字节一致
 * （Docker runner 阶段不拷贝 docs/，dev cwd 为 apps/server，运行时直读 docs/ 在两环境下都不可用）。
 *
 * 加载方式选择 readFileSync（而非 import + resolveJsonModule）：server tsconfig
 * 未开启 resolveJsonModule 且 composite 构建下开启它会引入额外约束，超出本任务变更范围。
 */

export interface ValidationResult {
  valid: boolean;
  /** 中文可读的错误消息，如 "name: 必填字段缺失"。 */
  errors: string[];
}

const ajv = new Ajv({ allErrors: true, strict: false });

function loadSchema(fileName: string): AnySchema {
  const schemaUrl = new URL(`./schemas/${fileName}`, import.meta.url);
  return JSON.parse(readFileSync(schemaUrl, 'utf-8')) as AnySchema;
}

const manifestValidator: ValidateFunction = ajv.compile(loadSchema('plugin.manifest.schema.json'));
const lifecycleEventValidator: ValidateFunction = ajv.compile(
  loadSchema('plugin.lifecycle-event.schema.json'),
);

/** 将 instancePath（如 "/provides/mcpServers/0/id"）转成 "provides.mcpServers[0].id"。 */
function fieldLabel(instancePath: string): string {
  if (instancePath === '') return '';
  return instancePath
    .slice(1)
    .split('/')
    .map((segment) => (/^\d+$/.test(segment) ? `[${segment}]` : `.${segment}`))
    .join('')
    .slice(1);
}

/** 将 ajv 错误对象映射为中文可读消息（基于 instancePath + keyword）。 */
function toMessages(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors) return [];
  return errors.map((error) => {
    const field = fieldLabel(error.instancePath);
    const params = error.params as Record<string, unknown>;
    const label = field || '根对象';
    switch (error.keyword) {
      case 'required': {
        const missing = String(params.missingProperty ?? '');
        return `${field ? `${field}.${missing}` : missing}: 必填字段缺失`;
      }
      case 'enum':
        return `${label}: 必须是以下值之一（${(params.allowedValues as unknown[]).join('、')}）`;
      case 'pattern':
        return `${label}: 格式不合法`;
      case 'minLength':
        return `${label}: 长度不能少于 ${params.limit} 个字符`;
      case 'maxLength':
        return `${label}: 长度不能超过 ${params.limit} 个字符`;
      case 'minItems':
        return `${label}: 至少需要 ${params.limit} 个元素`;
      case 'maxItems':
        return `${label}: 元素数量不能超过 ${params.limit}`;
      case 'uniqueItems':
        return `${label}: 元素不能重复`;
      case 'additionalProperties':
        return `${label}: 含未定义的额外属性（${String(params.additionalProperty)}）`;
      case 'type':
        return `${label}: 类型必须是 ${String(params.type)}`;
      case 'minimum':
        return `${label}: 不能小于 ${params.limit}`;
      case 'maximum':
        return `${label}: 不能大于 ${params.limit}`;
      case 'oneOf':
        return `${label}: 必须满足恰好一个子模式`;
      case 'anyOf':
        return `${label}: 必须满足至少一个子模式`;
      default:
        return `${label}: ${error.message ?? '校验失败'}`;
    }
  });
}

function run(validator: ValidateFunction, raw: unknown): ValidationResult {
  const valid = validator(raw);
  return { valid, errors: valid ? [] : toMessages(validator.errors) };
}

/** 校验 plugin.json 清单（docs/rfc/schemas/plugin.manifest.schema.json，draft-07）。 */
export function validateManifest(raw: unknown): ValidationResult {
  return run(manifestValidator, raw);
}

/** 校验生命周期事件记录（docs/rfc/schemas/plugin.lifecycle-event.schema.json，draft-07）。 */
export function validateLifecycleEvent(raw: unknown): ValidationResult {
  return run(lifecycleEventValidator, raw);
}
