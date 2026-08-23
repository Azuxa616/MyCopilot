type Token =
  | { type: 'number'; value: number }
  | { type: 'operator'; value: '+' | '-' | '*' | '/' | '%' | '**' }
  | { type: 'leftParen' }
  | { type: 'rightParen' };

type Operator = Extract<Token, { type: 'operator' }>['value'];

const MAX_EXPRESSION_LENGTH = 512;

export function evaluateExpression(expression: string): number {
  if (!expression.trim()) throw new Error('Expression cannot be empty');
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(`Expression exceeds ${MAX_EXPRESSION_LENGTH} characters`);
  }
  const parser = new ExpressionParser(tokenize(expression));
  const result = parser.parse();
  if (!Number.isFinite(result)) throw new Error('Expression result must be finite');
  return result;
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const character = expression[index]!;
    if (/\s/.test(character)) {
      index++;
      continue;
    }
    if (/[0-9.]/.test(character)) {
      const start = index;
      let dotCount = 0;
      let digitCount = 0;
      while (index < expression.length && /[0-9.]/.test(expression[index]!)) {
        if (expression[index] === '.') dotCount++;
        else digitCount++;
        index++;
      }
      if (dotCount > 1 || digitCount === 0) throw new Error('Invalid number literal');
      const value = Number(expression.slice(start, index));
      if (!Number.isFinite(value)) throw new Error('Invalid number literal');
      tokens.push({ type: 'number', value });
      continue;
    }
    if (character === '(') {
      tokens.push({ type: 'leftParen' });
      index++;
      continue;
    }
    if (character === ')') {
      tokens.push({ type: 'rightParen' });
      index++;
      continue;
    }
    if ('+-*/%'.includes(character)) {
      if (character === '*' && expression[index + 1] === '*') {
        tokens.push({ type: 'operator', value: '**' });
        index += 2;
      } else {
        tokens.push({
          type: 'operator',
          value: character as '+' | '-' | '*' | '/' | '%',
        });
        index++;
      }
      continue;
    }
    throw new Error(`Unsupported token "${character}"`);
  }
  return tokens;
}

class ExpressionParser {
  private index = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): number {
    const value = this.parseAdditive();
    if (this.index !== this.tokens.length) throw new Error('Unexpected token');
    return value;
  }

  private parseAdditive(): number {
    let value = this.parseMultiplicative();
    while (this.matchOperator('+') || this.matchOperator('-')) {
      const operator = this.previousOperator();
      const right = this.parseMultiplicative();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  private parseMultiplicative(): number {
    let value = this.parseUnary();
    while (
      this.matchOperator('*') ||
      this.matchOperator('/') ||
      this.matchOperator('%')
    ) {
      const operator = this.previousOperator();
      const right = this.parseUnary();
      if ((operator === '/' || operator === '%') && right === 0) {
        throw new Error('Division by zero');
      }
      if (operator === '*') value *= right;
      else if (operator === '/') value /= right;
      else value %= right;
    }
    return value;
  }

  private parseUnary(): number {
    if (this.matchOperator('+')) return this.parseUnary();
    if (this.matchOperator('-')) return -this.parseUnary();
    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();
    if (!this.matchOperator('**')) return base;
    return base ** this.parseUnary();
  }

  private parsePrimary(): number {
    const token = this.tokens[this.index];
    if (!token) throw new Error('Expected a number or parenthesized expression');
    if (token.type === 'number') {
      this.index++;
      return token.value;
    }
    if (token.type === 'leftParen') {
      this.index++;
      const value = this.parseAdditive();
      if (this.tokens[this.index]?.type !== 'rightParen') {
        throw new Error('Missing closing parenthesis');
      }
      this.index++;
      return value;
    }
    throw new Error('Expected a number or parenthesized expression');
  }

  private matchOperator(operator: Operator): boolean {
    const token = this.tokens[this.index];
    if (token?.type !== 'operator' || token.value !== operator) return false;
    this.index++;
    return true;
  }

  private previousOperator(): Extract<Token, { type: 'operator' }>['value'] {
    const token = this.tokens[this.index - 1];
    if (token?.type !== 'operator') throw new Error('Expected operator');
    return token.value;
  }
}
