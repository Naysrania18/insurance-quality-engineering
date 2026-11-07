import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  dedupe,
  extractJson,
  generateTestIdeas,
  similarity,
  suggestTriage,
  writeForReview,
} from './src/generator.js';
import { AnthropicClient, MockClient } from './src/llm.js';
import type { TestCase } from './src/schemas.js';

const tc = (title: string, extra: Partial<TestCase> = {}): TestCase => ({
  title,
  type: 'boundary',
  priority: 'P1',
  steps: ['do the thing'],
  expected: 'it works',
  ...extra,
});

const reply = (cases: TestCase[]) => JSON.stringify({ testCases: cases });
const STORY = 'As a broker I want to submit a risk so that an underwriter can quote it';

// All tests use a mocked LLM: CI never needs an API key or network access.
describe('generateTestIdeas', () => {
  it('returns schema-valid test cases marked for human review', async () => {
    const llm = new MockClient([
      reply([tc('Reject a risk below minimum value'), tc('Accept a risk at the maximum value')]),
    ]);
    const out = await generateTestIdeas(STORY, llm);
    expect(out.status).toBe('NEEDS_HUMAN_REVIEW');
    expect(out.testCases).toHaveLength(2);
    expect(llm.calls[0].user).toContain(STORY);
  });

  it('accepts JSON wrapped in markdown fences and prose', async () => {
    const wrapped =
      'Here you go:\n```json\n' +
      reply([tc('Reject negative insured value')]) +
      '\n```\nHope that helps';
    const out = await generateTestIdeas(STORY, new MockClient([wrapped]));
    expect(out.testCases[0].title).toBe('Reject negative insured value');
  });

  it('removes near-duplicate test cases', async () => {
    const llm = new MockClient([
      reply([
        tc('Reject a risk below the minimum insured value'),
        tc('Reject risk below minimum insured value'),
        tc('Premium is rounded half up to the cent'),
      ]),
    ]);
    const out = await generateTestIdeas(STORY, llm);
    expect(out.testCases.map((c) => c.title)).toEqual([
      'Reject a risk below the minimum insured value',
      'Premium is rounded half up to the cent',
    ]);
    expect(out.duplicatesRemoved).toBe(1);
  });

  it('retries once when the first reply violates the schema, then succeeds', async () => {
    const bad = JSON.stringify({ testCases: [{ title: 'x', type: 'magic', priority: 'P9' }] });
    const llm = new MockClient([bad, reply([tc('Reject malformed JSON body')])]);
    const out = await generateTestIdeas(STORY, llm);
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1].user).toMatch(/failed schema validation/);
    expect(out.testCases).toHaveLength(1);
  });

  it('fails loudly if the model keeps returning invalid output', async () => {
    await expect(generateTestIdeas(STORY, new MockClient(['not json at all']))).rejects.toThrow(
      /schema validation/,
    );
  });

  it('rejects unknown properties and out-of-range enums', async () => {
    const extra = JSON.stringify({
      testCases: [{ ...tc('Some valid looking title'), secret: 'x' }],
    });
    await expect(generateTestIdeas(STORY, new MockClient([extra]))).rejects.toThrow();
  });
});

describe('suggestTriage', () => {
  it('returns a validated category and severity', async () => {
    const llm = new MockClient([
      JSON.stringify({
        category: 'data-integrity',
        severity: 'major',
        rationale: 'Shares do not sum to the premium.',
      }),
    ]);
    const t = await suggestTriage('Shares add up to 80.02 but premium is 80.01', llm);
    expect(t).toMatchObject({ category: 'data-integrity', severity: 'major' });
  });

  it('rejects an invented category', async () => {
    const llm = new MockClient([
      JSON.stringify({ category: 'vibes', severity: 'major', rationale: 'not a real category' }),
    ]);
    await expect(suggestTriage('x', llm)).rejects.toThrow();
  });
});

describe('helpers', () => {
  it('similarity is 1 for identical and 0 for unrelated titles', () => {
    expect(similarity('premium rounding', 'premium rounding')).toBe(1);
    expect(similarity('premium rounding', 'claim settlement audit')).toBe(0);
  });
  it('dedupe keeps the first of a similar pair', () => {
    expect(
      dedupe([tc('Duplicate claim is rejected'), tc('duplicate claim rejected')]).kept,
    ).toHaveLength(1);
  });
  it('extractJson throws when there is no object', () => {
    expect(() => extractJson('nope')).toThrow(/No JSON/);
  });
});

describe('safety guarantees', () => {
  it('writes generated output only to a review folder, never into tests/', async () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), 'ai-')), 'review');
    const ideas = await generateTestIdeas(
      STORY,
      new MockClient([reply([tc('Reject a risk below minimum')])]),
    );
    const file = writeForReview(ideas, 'my story', dir);
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8')).status).toBe('NEEDS_HUMAN_REVIEW');
    expect(() => writeForReview(ideas, 'x', path.join(tmpdir(), 'tests'))).toThrow(/review folder/);
    rmSync(path.dirname(dir), { recursive: true, force: true });
  });

  it('requires the API key from the environment (no key => clear error, no network call)', () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => new AnthropicClient()).toThrow(/ANTHROPIC_API_KEY/);
    if (saved) process.env.ANTHROPIC_API_KEY = saved;
  });
});
