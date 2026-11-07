import Ajv from 'ajv';

export const TEST_TYPES = [
  'functional',
  'boundary',
  'negative',
  'integration',
  'security',
  'performance',
  'data',
] as const;
export const PRIORITIES = ['P1', 'P2', 'P3'] as const;
export const TRIAGE_CATEGORIES = [
  'functional',
  'data-integrity',
  'integration',
  'performance',
  'security',
  'usability',
  'configuration',
] as const;
export const SEVERITIES = ['critical', 'major', 'minor', 'trivial'] as const;

export const testIdeasSchema = {
  type: 'object',
  required: ['testCases'],
  additionalProperties: false,
  properties: {
    testCases: {
      type: 'array',
      minItems: 1,
      maxItems: 30,
      items: {
        type: 'object',
        required: ['title', 'type', 'priority', 'steps', 'expected'],
        additionalProperties: false,
        properties: {
          title: { type: 'string', minLength: 5, maxLength: 160 },
          type: { enum: [...TEST_TYPES] },
          priority: { enum: [...PRIORITIES] },
          preconditions: { type: 'array', items: { type: 'string' } },
          steps: { type: 'array', minItems: 1, items: { type: 'string', minLength: 3 } },
          expected: { type: 'string', minLength: 3 },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

export const triageSchema = {
  type: 'object',
  required: ['category', 'severity', 'rationale'],
  additionalProperties: false,
  properties: {
    category: { enum: [...TRIAGE_CATEGORIES] },
    severity: { enum: [...SEVERITIES] },
    rationale: { type: 'string', minLength: 10, maxLength: 600 },
    suspectedArea: { type: 'string' },
    nextStep: { type: 'string' },
  },
} as const;

const ajv = new Ajv({ allErrors: true });
export const validateTestIdeas = ajv.compile(testIdeasSchema);
export const validateTriage = ajv.compile(triageSchema);

export interface TestCase {
  title: string;
  type: (typeof TEST_TYPES)[number];
  priority: (typeof PRIORITIES)[number];
  preconditions?: string[];
  steps: string[];
  expected: string;
  tags?: string[];
}
export interface Triage {
  category: (typeof TRIAGE_CATEGORIES)[number];
  severity: (typeof SEVERITIES)[number];
  rationale: string;
  suspectedArea?: string;
  nextStep?: string;
}
