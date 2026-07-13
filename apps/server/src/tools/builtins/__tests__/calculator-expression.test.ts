import { describe, expect, it } from 'vitest';
import { evaluateExpression } from '../calculator-expression.js';

describe('evaluateExpression', () => {
  it('honors precedence and parentheses', () => {
    expect(evaluateExpression('2 + 3 * 4')).toBe(14);
    expect(evaluateExpression('(2 + 3) * 4')).toBe(20);
  });

  it('supports unary signs and right-associative powers', () => {
    expect(evaluateExpression('-2 ** 2')).toBe(-4);
    expect(evaluateExpression('2 ** 3 ** 2')).toBe(512);
    expect(evaluateExpression('2 ** -2')).toBe(0.25);
  });

  it('supports modulo', () => {
    expect(evaluateExpression('17 % 5')).toBe(2);
  });

  it.each(['1 / 0', '1 % 0'])(
    'rejects division by zero in %s',
    (expression) => {
      expect(() => evaluateExpression(expression)).toThrow('Division by zero');
    },
  );

  it.each(['2 & 3', '.', '1..2', '(1 + 2'])(
    'rejects invalid expression %s',
    (expression) => {
      expect(() => evaluateExpression(expression)).toThrow();
    },
  );

  it('rejects empty and oversized expressions', () => {
    expect(() => evaluateExpression('  ')).toThrow('cannot be empty');
    expect(() => evaluateExpression('1'.repeat(513))).toThrow('exceeds 512');
  });

  it('rejects non-finite results', () => {
    expect(() => evaluateExpression('10 ** 1000')).toThrow('must be finite');
  });
});
