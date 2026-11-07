import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LlmClient } from './llm.js';
import { validateTestIdeas, validateTriage, type TestCase, type Triage } from './schemas.js';

export const REVIEW_DIR = path.resolve('ai-testing', 'review');

const TEST_SYSTEM = `You are a senior QA engineer for a commercial insurance platform (marine cargo and commercial property,
co-insurance across multiple insurers, claims). Given a user story, propose test cases.
Reply with ONLY a JSON object: {"testCases":[{"title","type","priority","preconditions","steps","expected","tags"}]}.
type is one of functional|boundary|negative|integration|security|performance|data. priority is P1|P2|P3.
Include boundary values and negative cases. Never invent real company names or personal data.`;

const TRIAGE_SYSTEM = `You triage defect reports for a commercial insurance platform. Reply with ONLY a JSON object:
{"category","severity","rationale","suspectedArea","nextStep"}.
category is one of functional|data-integrity|integration|performance|security|usability|configuration.
severity is one of critical|major|minor|trivial. Money or audit-trail errors are never below major.`;

/** Strip markdown fences and surrounding prose; return the first JSON object found. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in model output');
  return JSON.parse(candidate.slice(start, end + 1));
}

const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );

export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** Remove near-duplicate test cases (Jaccard similarity of title tokens above the threshold). */
export function dedupe(
  cases: TestCase[],
  threshold = 0.8,
): { kept: TestCase[]; removed: TestCase[] } {
  const kept: TestCase[] = [];
  const removed: TestCase[] = [];
  for (const c of cases) {
    if (kept.some((k) => similarity(k.title, c.title) >= threshold)) removed.push(c);
    else kept.push(c);
  }
  return { kept, removed };
}

async function askForJson<T>(
  llm: LlmClient,
  system: string,
  user: string,
  validate: (v: unknown) => boolean,
  errorsOf: () => string,
): Promise<T> {
  let prompt = user;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await llm.complete(system, prompt);
    try {
      const parsed = extractJson(raw);
      if (validate(parsed)) return parsed as T;
      prompt = `${user}\n\nYour previous reply failed schema validation: ${errorsOf()}. Reply again with valid JSON only.`;
    } catch (e) {
      prompt = `${user}\n\nYour previous reply was not valid JSON (${(e as Error).message}). Reply with valid JSON only.`;
    }
  }
  throw new Error('Model output failed JSON schema validation after one retry');
}

export interface GeneratedIdeas {
  story: string;
  generatedAt: string;
  status: 'NEEDS_HUMAN_REVIEW';
  note: string;
  testCases: TestCase[];
  duplicatesRemoved: number;
}

export async function generateTestIdeas(story: string, llm: LlmClient): Promise<GeneratedIdeas> {
  const out = await askForJson<{ testCases: TestCase[] }>(
    llm,
    TEST_SYSTEM,
    `User story:\n${story}`,
    (v) => validateTestIdeas(v) as boolean,
    () => JSON.stringify(validateTestIdeas.errors),
  );
  const { kept, removed } = dedupe(out.testCases);
  return {
    story,
    generatedAt: new Date().toISOString(),
    status: 'NEEDS_HUMAN_REVIEW',
    note: 'AI-generated suggestions. Review, edit and hand-write real tests; nothing here runs in the suite.',
    testCases: kept,
    duplicatesRemoved: removed.length,
  };
}

export async function suggestTriage(defectText: string, llm: LlmClient): Promise<Triage> {
  return askForJson<Triage>(
    llm,
    TRIAGE_SYSTEM,
    `Defect report:\n${defectText}`,
    (v) => validateTriage(v) as boolean,
    () => JSON.stringify(validateTriage.errors),
  );
}

/** Generated output is only ever written under ai-testing/review (never into tests/). */
export function writeForReview(ideas: GeneratedIdeas, name: string, dir = REVIEW_DIR): string {
  const safe = name.replace(/[^a-z0-9-_]/gi, '-').slice(0, 60) || 'story';
  const resolved = path.resolve(dir);
  if (path.basename(resolved) !== 'review') {
    throw new Error('Refusing to write generated tests outside a review folder');
  }
  mkdirSync(resolved, { recursive: true });
  const file = path.join(resolved, `${safe}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(ideas, null, 2));
  return file;
}
