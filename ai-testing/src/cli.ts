/**
 * Usage:
 *   npm run ai:generate -- --story "As a broker I want ..."            (needs ANTHROPIC_API_KEY)
 *   npm run ai:generate -- --story-file docs/story.txt
 *   npm run ai:generate -- --triage "Shares do not add up to premium"  (defect triage suggestion)
 *   add --mock to run offline with a canned response
 */
import { readFileSync } from 'node:fs';
import { generateTestIdeas, suggestTriage, writeForReview } from './generator.js';
import { AnthropicClient, MockClient, type LlmClient } from './llm.js';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const mockIdeas = JSON.stringify({
  testCases: [
    {
      title: 'Reject a risk below the minimum insured value',
      type: 'boundary',
      priority: 'P1',
      steps: ['Submit a risk worth 9,999.99'],
      expected: 'HTTP 400 validation_error',
    },
  ],
});
const mockTriage = JSON.stringify({
  category: 'data-integrity',
  severity: 'major',
  rationale: 'Insurer shares do not sum to the premium, which is a financial accuracy issue.',
});

const llm: LlmClient = flag('mock')
  ? new MockClient([flag('triage') || value('triage') ? mockTriage : mockIdeas])
  : new AnthropicClient();

const triageText = value('triage');
if (triageText) {
  console.log(JSON.stringify(await suggestTriage(triageText, llm), null, 2));
} else {
  const story =
    value('story') ??
    (value('story-file') ? readFileSync(value('story-file')!, 'utf8') : undefined);
  if (!story) {
    console.error('Provide --story "<text>", --story-file <path> or --triage "<defect text>"');
    process.exit(2);
  }
  const ideas = await generateTestIdeas(story, llm);
  const file = writeForReview(ideas, story.slice(0, 40));
  console.log(
    `Wrote ${ideas.testCases.length} suggestions (${ideas.duplicatesRemoved} duplicates removed) to ${file}`,
  );
  console.log('These are NOT added to the test suite. Review them by hand.');
}
