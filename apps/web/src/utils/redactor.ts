/**
 * Recursively redacts sensitive data from objects.
 * Replaces values of keys matching token|auth|key|secret|password|credential with "***REDACTED***".
 * Returns a new deep-cloned object, never mutates the input.
 */

export const REDACTED_KEYS_REGEX = /token|auth|key|secret|password|credential/i;

const REDACTED_VALUE = '***REDACTED***';

export function redactSensitive(obj: unknown): unknown {
  // Track seen objects to handle circular references
  const seen = new WeakSet<object>();

  function clone(value: unknown): unknown {
    // Handle primitives and null/undefined
    if (value === null || value === undefined) {
      return value;
    }

    // Handle primitives (string, number, boolean, bigint, symbol)
    if (typeof value !== 'object') {
      return value;
    }

    // Handle Date instances
    if (value instanceof Date) {
      return new Date(value.getTime());
    }

    // Handle arrays
    if (Array.isArray(value)) {
      // Check for circular reference
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);

      return value.map((item) => clone(item));
    }

    // Handle plain objects
    if (Object.prototype.toString.call(value) === '[object Object]') {
      // Check for circular reference
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);

      const cloned: Record<string, unknown> = {};

      for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          const originalValue = (value as Record<string, unknown>)[key];

          // Check if key matches sensitive pattern
          if (REDACTED_KEYS_REGEX.test(key)) {
            cloned[key] = REDACTED_VALUE;
          } else {
            cloned[key] = clone(originalValue);
          }
        }
      }

      return cloned;
    }

    // For other object types (RegExp, Map, Set, etc.), return as-is
    return value;
  }

  return clone(obj);
}