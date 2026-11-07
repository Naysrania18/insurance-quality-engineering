import Anthropic from '@anthropic-ai/sdk';

export interface LlmClient {
  complete(system: string, user: string): Promise<string>;
}

/** The API key is read from the environment only; it is never accepted as an argument or stored. */
export class AnthropicClient implements LlmClient {
  private client: Anthropic;
  constructor(
    apiKey = process.env.ANTHROPIC_API_KEY,
    private model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5',
  ) {
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. Copy .env.example, export the variable, or use --mock.',
      );
    }
    this.client = new Anthropic({ apiKey });
  }

  async complete(system: string, user: string): Promise<string> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 4000,
      system,
      messages: [{ role: 'user', content: user }],
    });
    return res.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('');
  }
}

/** Deterministic client for tests and offline demos. */
export class MockClient implements LlmClient {
  calls: { system: string; user: string }[] = [];
  constructor(private responses: string[]) {}
  async complete(system: string, user: string): Promise<string> {
    this.calls.push({ system, user });
    const next = this.responses.length > 1 ? this.responses.shift()! : this.responses[0];
    return next;
  }
}
