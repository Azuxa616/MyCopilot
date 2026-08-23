import type { ToolExecutor } from '../registry.js';
import {
  builtinTool,
  executeLocalTool,
  jsonResult,
  optionalString,
} from './helpers.js';

export const currentDatetimeExecutor: ToolExecutor = {
  describe: () => builtinTool({
    id: 'current-datetime',
    name: 'current_datetime',
    description: 'Get the current date and time in UTC and optionally format it for an IANA time zone and locale.',
    fields: [
      { name: 'timeZone', type: 'string', description: 'Optional IANA time zone such as Asia/Hong_Kong', required: false },
      { name: 'locale', type: 'string', description: 'Optional locale such as en-US or zh-CN', required: false },
    ],
  }),
  async execute(args, context) {
    return executeLocalTool(context, () => {
      const timeZone = optionalString(args, 'timeZone', 128)
        ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      const locale = optionalString(args, 'locale', 64) ?? 'en-US';
      const now = new Date();
      const formatted = new Intl.DateTimeFormat(locale, {
        timeZone,
        dateStyle: 'full',
        timeStyle: 'long',
      }).format(now);
      return jsonResult({
        isoUtc: now.toISOString(),
        unixMs: now.getTime(),
        timeZone,
        locale,
        formatted,
      });
    });
  },
};
