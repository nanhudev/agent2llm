/**
 * Provider abstraction for the generic API Brain.
 *
 * Deliberately NOT OpenAI-shaped. The interface is "send a system prompt plus
 * a user turn, get text back", which any chat-completions-style provider can
 * satisfy. Provider-specific wiring lives here and nowhere else.
 */
export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatTurn[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatCompletionResponse {
  text: string;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

export interface BrainProvider {
  id: string;
  displayName: string;
  defaultModel: string;
  /** Env var holding the credential. Never stored in the repo or workspace. */
  credentialEnv: string;
  baseUrl: string;
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
}

export interface ProviderConfig {
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  /** Extra headers, e.g. gateway routing. */
  headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 120_000;

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Provider responded ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function readPath(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** OpenAI-compatible chat completions. Works for most gateways too. */
export function createOpenAiCompatibleProvider(config: ProviderConfig = {}): BrainProvider {
  const baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
  return {
    id: "openai-compatible",
    displayName: "OpenAI-compatible API",
    defaultModel: config.model ?? "gpt-4o-mini",
    credentialEnv: "OPENAI_API_KEY",
    baseUrl,
    async complete(request) {
      const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");
      const body = await postJson(
        `${baseUrl}/chat/completions`,
        {
          model: request.model,
          messages: request.messages,
          temperature: request.temperature ?? 0.2,
          ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
        },
        {
          authorization: `Bearer ${apiKey}`,
          ...(config.headers ?? {}),
        }
      );
      const text = readPath(body, ["choices", "0", "message", "content"]);
      return {
        text: typeof text === "string" ? text : "",
        model: String(readPath(body, ["model"]) ?? request.model),
        usage: {
          promptTokens: Number(readPath(body, ["usage", "prompt_tokens"]) ?? 0) || undefined,
          completionTokens: Number(readPath(body, ["usage", "completion_tokens"]) ?? 0) || undefined,
        },
      };
    },
  };
}

/** Anthropic messages API. */
export function createAnthropicProvider(config: ProviderConfig = {}): BrainProvider {
  const baseUrl = config.baseUrl ?? "https://api.anthropic.com/v1";
  return {
    id: "anthropic",
    displayName: "Anthropic API",
    defaultModel: config.model ?? "claude-sonnet-4-5",
    credentialEnv: "ANTHROPIC_API_KEY",
    baseUrl,
    async complete(request) {
      const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
      const system = request.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const messages = request.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content }));
      const body = await postJson(
        `${baseUrl}/messages`,
        {
          model: request.model,
          max_tokens: request.maxTokens ?? 4096,
          ...(system ? { system } : {}),
          messages,
        },
        {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          ...(config.headers ?? {}),
        }
      );
      const content = readPath(body, ["content", "0", "text"]);
      return {
        text: typeof content === "string" ? content : "",
        model: String(readPath(body, ["model"]) ?? request.model),
        usage: {
          promptTokens: Number(readPath(body, ["usage", "input_tokens"]) ?? 0) || undefined,
          completionTokens: Number(readPath(body, ["usage", "output_tokens"]) ?? 0) || undefined,
        },
      };
    },
  };
}

export const BUILTIN_PROVIDERS: readonly BrainProvider[] = [
  createOpenAiCompatibleProvider(),
  createAnthropicProvider(),
];
