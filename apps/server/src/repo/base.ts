import { getDb } from '../db/index.js';
import { randomUUID } from 'node:crypto';

export function generateId(): string {
  return randomUUID();
}

export function now(): number {
  return Date.now();
}

export function withTransaction<T>(operation: () => T): T {
  return getDb().transaction(operation)();
}
