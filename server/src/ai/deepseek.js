/**
 * DeepSeek chat client (JSON mode), no SDK, no dependencies.
 * Used by the AI controller to localise titles/descriptions and pick a category.
 */
export class DeepSeekClient {
  constructor({ apiKey, baseUrl, model, timeoutMs = 90_000, maxRetries = 3, logger }) {
    this.apiKey = apiKey ?? '';
    this.baseUrl = String(baseUrl ?? 'https://api.deepseek.com').replace(/\/$/, '');
    this.model = model ?? 'deepseek-chat';
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.logger = logger;
  }

  get enabled() {
    return Boolean(this.apiKey);
  }

  async completeJSON({ system, user, maxTokens = 2400, temperature = 0.2 }) {
    if (!this.enabled) throw new Error('DeepSeek API key is not configured');

    const payload = {
      model: this.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      stream: false,
    };

    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (response.status === 429 || response.status >= 500) {
          const retryAfter = Number(response.headers.get('retry-after'));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(1000 * 2 ** attempt, 15_000);
          lastError = new Error(`DeepSeek responded ${response.status}`);
          if (attempt < this.maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, wait));
            continue;
          }
          throw lastError;
        }

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(`DeepSeek responded ${response.status}: ${text.slice(0, 300)}`);
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content) throw new Error('DeepSeek returned an empty completion');
        return this.parseJsonContent(content);
      } catch (error) {
        lastError = error;
        const isAbort = error.name === 'AbortError';
        if (attempt < this.maxRetries && (isAbort || /responded 5|network|fetch failed/i.test(error.message))) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 10_000)));
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError ?? new Error('DeepSeek request failed');
  }

  parseJsonContent(content) {
    const trimmed = String(content).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      const first = trimmed.indexOf('{');
      const last = trimmed.lastIndexOf('}');
      if (first !== -1 && last > first) {
        return JSON.parse(trimmed.slice(first, last + 1));
      }
      throw new Error('DeepSeek returned malformed JSON');
    }
  }
}
