/**
 * Minimal DeepSeek chat client (server-side only).
 *
 * DeepSeek is OpenAI-compatible, so this is a thin fetch wrapper with a hard
 * timeout and total graceful-degradation: every failure path returns null so
 * callers fall back to the deterministic rule-based engine. The API key is read
 * from the environment at call time and never leaves the server.
 */
type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

interface ChatOpts {
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

const cfg = () => ({
  key: process.env.DEEPSEEK_API_KEY,
  model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  base: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
});

/** True when a key is configured — used to decide AI vs rule-based path. */
export function isAIEnabled(): boolean {
  return !!cfg().key;
}

/** Raw chat completion → assistant text, or null on any failure. */
export async function deepseekChat(messages: ChatMessage[], opts: ChatOpts = {}): Promise<string | null> {
  const { key, model, base } = cfg();
  if (!key) return null;

  const { json = false, maxTokens = 700, temperature = 0.4, timeoutMs = 18000 } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`[deepseek] HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    console.warn(`[deepseek] request failed: ${(err as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Chat completion parsed as JSON of shape T, or null. Tolerates fenced/extra text. */
export async function deepseekJSON<T>(system: string, user: string, opts: ChatOpts = {}): Promise<T | null> {
  const content = await deepseekChat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { ...opts, json: true }
  );
  if (!content) return null;
  try {
    return JSON.parse(content) as T;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}
