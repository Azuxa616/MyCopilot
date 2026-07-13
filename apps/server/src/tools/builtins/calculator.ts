import type { ToolExecutor } from '../registry.js';
import { evaluateExpression } from './calculator-expression.js';
import {
  builtinTool,
  executeLocalTool,
  jsonResult,
  requiredString,
} from './helpers.js';

export const calculatorExecutor: ToolExecutor = {
  describe: () => builtinTool({
    id: 'calculator',
    name: 'calculator',
    description: 'Evaluate a basic arithmetic expression without executing code.',
    fields: [
      { name: 'expression', type: 'string', description: 'Expression using parentheses, +, -, *, /, %, and **', required: true },
    ],
  }),
  async execute(args, context) {
    return executeLocalTool(context, () => {
      const expression = requiredString(args, 'expression', 512);
      return jsonResult({ expression, result: evaluateExpression(expression) });
    });
  },
};
