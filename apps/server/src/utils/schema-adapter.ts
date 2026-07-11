import type { ToolInputSchema, ToolInputSchemaField } from '@my-copilot/shared';

/**
 * Converts internal ToolInputSchema to OpenAI-compatible JSON Schema format.
 *
 * @param schema - Internal ToolInputSchema with fields array
 * @returns JSON Schema object with type, properties, and required fields
 */
export function toolInputSchemaToJsonSchema(
  schema: ToolInputSchema,
): Record<string, unknown> {
  const properties: Record<string, { type: string; description: string }> = {};
  const required: string[] = [];

  for (const field of schema.fields) {
    properties[field.name] = {
      type: field.type,
      description: field.description,
    };

    if (field.required) {
      required.push(field.name);
    }
  }

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
  };
}

/**
 * Converts OpenAI-compatible JSON Schema to internal ToolInputSchema format.
 *
 * @param schema - JSON Schema object with type, properties, and optional required fields
 * @returns Internal ToolInputSchema with fields array
 */
export function jsonSchemaToToolInputSchema(schema: Record<string, unknown>): ToolInputSchema {
  const properties = schema.properties as Record<string, unknown> | undefined;
  const required = (schema.required as string[]) ?? [];

  if (!properties) {
    return { fields: [] };
  }

  const fields: ToolInputSchemaField[] = [];

  for (const [name, prop] of Object.entries(properties)) {
    const propObj = prop as Record<string, unknown>;
    const type = propObj.type as ToolInputSchemaField['type'];
    const description = (propObj.description as string) ?? '';

    fields.push({
      name,
      type,
      description,
      required: required.includes(name),
    });
  }

  return { fields };
}