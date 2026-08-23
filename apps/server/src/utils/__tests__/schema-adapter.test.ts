import { describe, expect, it } from 'vitest';
import { jsonSchemaToToolInputSchema, toolInputSchemaToJsonSchema } from '../schema-adapter.js';

describe('schema-adapter', () => {
  describe('toolInputSchemaToJsonSchema', () => {
    it('converts simple string field', () => {
      const input = {
        fields: [
          {
            name: 'city',
            type: 'string' as const,
            description: 'The city name',
            required: true,
          },
        ],
      };

      const result = toolInputSchemaToJsonSchema(input);

      expect(result).toEqual({
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: 'The city name',
          },
        },
        required: ['city'],
      });
    });

    it('converts required + optional mixed fields', () => {
      const input = {
        fields: [
          {
            name: 'query',
            type: 'string' as const,
            description: 'Search query',
            required: true,
          },
          {
            name: 'limit',
            type: 'number' as const,
            description: 'Result limit',
            required: false,
          },
        ],
      };

      const result = toolInputSchemaToJsonSchema(input);

      expect(result).toEqual({
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query',
          },
          limit: {
            type: 'number',
            description: 'Result limit',
          },
        },
        required: ['query'],
      });
    });

    it('converts multiple types (number + boolean)', () => {
      const input = {
        fields: [
          {
            name: 'price',
            type: 'number' as const,
            description: 'Item price',
            required: true,
          },
          {
            name: 'inStock',
            type: 'boolean' as const,
            description: 'Stock availability',
            required: true,
          },
        ],
      };

      const result = toolInputSchemaToJsonSchema(input);

      expect(result).toEqual({
        type: 'object',
        properties: {
          price: {
            type: 'number',
            description: 'Item price',
          },
          inStock: {
            type: 'boolean',
            description: 'Stock availability',
          },
        },
        required: ['price', 'inStock'],
      });
    });

    it('converts object field (shallow)', () => {
      const input = {
        fields: [
          {
            name: 'config',
            type: 'object' as const,
            description: 'Configuration object',
            required: false,
          },
        ],
      };

      const result = toolInputSchemaToJsonSchema(input);

      expect(result).toEqual({
        type: 'object',
        properties: {
          config: {
            type: 'object',
            description: 'Configuration object',
          },
        },
        required: undefined,
      });
    });

    it('converts real OpenAI weather fixture', () => {
      const input = {
        fields: [
          {
            name: 'location',
            type: 'string' as const,
            description: 'The city and state, e.g. San Francisco, CA',
            required: true,
          },
          {
            name: 'unit',
            type: 'string' as const,
            description: 'The unit of temperature to return',
            required: false,
          },
        ],
      };

      const result = toolInputSchemaToJsonSchema(input);

      expect(result).toEqual({
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'The city and state, e.g. San Francisco, CA',
          },
          unit: {
            type: 'string',
            description: 'The unit of temperature to return',
          },
        },
        required: ['location'],
      });
    });

    it('converts array type', () => {
      const input = {
        fields: [
          {
            name: 'tags',
            type: 'array' as const,
            description: 'List of tags',
            required: false,
          },
        ],
      };

      const result = toolInputSchemaToJsonSchema(input);

      expect(result).toEqual({
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            description: 'List of tags',
          },
        },
        required: undefined,
      });
    });
  });

  describe('jsonSchemaToToolInputSchema', () => {
    it('converts simple string field', () => {
      const input = {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: 'The city name',
          },
        },
        required: ['city'],
      };

      const result = jsonSchemaToToolInputSchema(input);

      expect(result).toEqual({
        fields: [
          {
            name: 'city',
            type: 'string',
            description: 'The city name',
            required: true,
          },
        ],
      });
    });

    it('converts required + optional mixed fields', () => {
      const input = {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query',
          },
          limit: {
            type: 'number',
            description: 'Result limit',
          },
        },
        required: ['query'],
      };

      const result = jsonSchemaToToolInputSchema(input);

      expect(result).toEqual({
        fields: [
          {
            name: 'query',
            type: 'string',
            description: 'Search query',
            required: true,
          },
          {
            name: 'limit',
            type: 'number',
            description: 'Result limit',
            required: false,
          },
        ],
      });
    });

    it('handles missing required array', () => {
      const input = {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query',
          },
        },
      };

      const result = jsonSchemaToToolInputSchema(input);

      expect(result).toEqual({
        fields: [
          {
            name: 'query',
            type: 'string',
            description: 'Search query',
            required: false,
          },
        ],
      });
    });

    it('handles empty properties', () => {
      const input = {
        type: 'object',
        properties: {},
        required: [],
      };

      const result = jsonSchemaToToolInputSchema(input);

      expect(result).toEqual({
        fields: [],
      });
    });

    it('handles missing properties', () => {
      const input = {
        type: 'object',
      };

      const result = jsonSchemaToToolInputSchema(input);

      expect(result).toEqual({
        fields: [],
      });
    });

    it('handles missing description', () => {
      const input = {
        type: 'object',
        properties: {
          city: {
            type: 'string',
          },
        },
      };

      const result = jsonSchemaToToolInputSchema(input);

      expect(result).toEqual({
        fields: [
          {
            name: 'city',
            type: 'string',
            description: '',
            required: false,
          },
        ],
      });
    });
  });

  describe('round-trip conversion', () => {
    it('tool→json→tool preserves data', () => {
      const original = {
        fields: [
          {
            name: 'location',
            type: 'string' as const,
            description: 'The city and state',
            required: true,
          },
          {
            name: 'unit',
            type: 'string' as const,
            description: 'Temperature unit',
            required: false,
          },
        ],
      };

      const jsonSchema = toolInputSchemaToJsonSchema(original);
      const convertedBack = jsonSchemaToToolInputSchema(jsonSchema);

      expect(convertedBack).toEqual(original);
    });

    it('handles all five types in round-trip', () => {
      const original = {
        fields: [
          {
            name: 'str',
            type: 'string' as const,
            description: 'String field',
            required: true,
          },
          {
            name: 'num',
            type: 'number' as const,
            description: 'Number field',
            required: true,
          },
          {
            name: 'bool',
            type: 'boolean' as const,
            description: 'Boolean field',
            required: true,
          },
          {
            name: 'obj',
            type: 'object' as const,
            description: 'Object field',
            required: false,
          },
          {
            name: 'arr',
            type: 'array' as const,
            description: 'Array field',
            required: false,
          },
        ],
      };

      const jsonSchema = toolInputSchemaToJsonSchema(original);
      const convertedBack = jsonSchemaToToolInputSchema(jsonSchema);

      expect(convertedBack).toEqual(original);
    });
  });
});