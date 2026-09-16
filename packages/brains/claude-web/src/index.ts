/**
 * Claude Web Brain adapter.
 *
 * Uses the official Claude web interface and, where available, the official
 * remote MCP connector. Explicitly forbidden and not implemented anywhere:
 * reverse-engineered private APIs, session-token hijacking, cookie access.
 */
import { emptyManifest, withCapabilities, type CapabilityManifest } from "@agent2llm/protocol";
import { encodeControlMessage, parseControlBlock } from "@agent2llm/protocol";
import type { ControlMessage } from "@agent2llm/protocol";
import {
  BaseBrainAdapter,
  type AdapterMetadata,
  type BrainCheckpoint,
  type BrainSession,
  type BrainSessionContext,
  type DetectionResult,
  type DetectContext,
  type SetupContext,
  type SetupResult,
  type VerificationResult,
} from "@agent2llm/adapter-sdk";
import { AuthStore } from "@agent2llm/auth";
import { probeBrowserModule, type BrowserSelectors } from "@agent2llm/transports";
import {
  WebBrainSession,
  asTransportMode,
  clearWebRef,
  loadWebRef,
  selectTransport,
} from "@agent2llm/brain-web-runtime";

export const CLAUDE_URLS = {
  base: "https://claude.ai",
  newChat: "https://claude.ai/new",
  connectors: "https://claude.ai/settings/connectors",
} as const;

export const CLAUDE_SELECTORS: BrowserSelectors = {
  composer: "div[contenteditable='true'].ProseMirror, fieldset div[contenteditable='true']",
  assistantMessage: "div[data-is-streaming='false'].font-claude-message, .font-claude-message",
  streaming: "div[data-is-streaming='true']",
  challenge: "form[data-testid='login-form'], #cf-challenge-running",
};

const CONFIG = {
  adapterId: "claude-web",
  displayName: "Claude",
  newConversationUrl: CLAUDE_URLS.newChat,
  conversationUrlPrefix: CLAUDE_URLS.base,
  connectorUrl: CLAUDE_URLS.connectors,
  selectors: CLAUDE_SELECTORS,
} as const;

const sessions = new Map<string, WebBrainSession>();

export class ClaudeWebBrain extends BaseBrainAdapter {
  metadata(): AdapterMetadata {
    return {
      id: "claude-web",
      name: "Claude",
      version: "0.1.0",
      role: "brain",
      vendor: "Anthropic",
      homepage: "https://claude.ai",
      experimental: true,
    };
  }

  async detect(_ctx: DetectContext = {}): Promise<DetectionResult> {
    const saved = loadWebRef("claude-web");
    const selection = await selectTransport();
    const notes: string[] = [selection.reason];
    if (selection.mode === "manual") {
      notes.push(
        "Install Playwright, or leave a Chromium window open with a DevTools port, to automate this Brain."
      );
    }
    if (!saved) {
      return {
        status: "implemented",
        reason: "No saved Claude conversation yet. Run `agent2llm setup --brain claude-web`.",
        notes,
      };
    }
    return { status: "configured", reason: `Saved conversation ${saved.url} (${saved.mode} transport).`, notes };
  }

  async buildCapabilities(): Promise<CapabilityManifest> {
    const browser = probeBrowserModule();
    const selection = await selectTransport();
    const transport: CapabilityManifest["transport"] =
      selection.mode === "cdp" ? "cdp" : selection.mode === "playwright" ? "browser" : "manual";
    const base = withCapabilities(emptyManifest(transport), [
      "session.create",
      "session.attach",
      "session.resume",
      "session.cancel",
      "workspace.read",
      "git.inspect",
      "conversation.send",
      "conversation.receive",
      "plan.generate",
      "review.perform",
      "mcp.remote",
      "interactiveApprovals",
    ]);
    return {
      ...base,
      transport,
      experimental: true,
      capabilities: {
        ...base.capabilities,
        structuredOutput: {
          supported: true,
          level: "partial",
          experimental: false,
          notes: "Text [A2L] block, not JSON.",
        },
        // Headless operation depends on the plan tier; declared, not assumed.
        supportsHeadless: { supported: false, level: "partial", experimental: true, notes: "Depends on plan and official connector availability." },
      },
      limitations: [
        "Requires the official Claude connector or manual conversation URL; no private API access.",
        "Some connector features depend on the Claude plan; capabilities are probed, never assumed.",
        "DOM selectors are version-sensitive.",
      ],
      auth: { required: true, authenticated: false, checked: false, method: "official web login + MCP connector" },
      facts: {
        playwrightInstalled: browser.installed,
        transport,
        transportReason: selection.reason,
      },
    };
  }

  override async setup(ctx: SetupContext): Promise<SetupResult> {
    if (loadWebRef("claude-web")) {
      return { ok: true, status: "configured", message: "Reusing the saved Claude conversation." };
    }
    if (!ctx.requestUserAction) {
      return { ok: false, status: "configured", message: "A browser action is required but no interactive handler is available." };
    }
    await ctx.requestUserAction({
      kind: "open-url",
      message: `Add the Agent2LLM MCP connector for workspace '${ctx.workspaceId}' in Claude settings.`,
      url: CLAUDE_URLS.connectors,
    });
    await ctx.requestUserAction({
      kind: "login",
      message: "Open a new Claude conversation in the browser window, then continue.",
      url: CLAUDE_URLS.newChat,
    });
    return { ok: true, status: "configured", message: "Claude connector configured." };
  }

  async createSession(ctx: BrainSessionContext): Promise<BrainSession> {
    // Prefer a window the user already has open. See selectTransport.
    const selection = await selectTransport();
    const driver = new WebBrainSession(CONFIG, {
      mode: selection.mode,
      ...(selection.endpoint ? { endpoint: selection.endpoint } : {}),
    });
    const ref = await driver.open(CLAUDE_URLS.newChat);
    sessions.set(ctx.sessionId, driver);
    return { id: ctx.sessionId, adapterId: "claude-web", ref: { url: ref.url, mode: ref.mode } };
  }

  async attachSession(checkpoint: BrainCheckpoint): Promise<BrainSession> {
    const mode = asTransportMode(checkpoint.ref.mode);
    const endpoint = typeof checkpoint.ref.endpoint === "string" ? checkpoint.ref.endpoint : undefined;
    const driver = new WebBrainSession(CONFIG, { mode, ...(endpoint ? { endpoint } : {}) });
    await driver.attach({
      mode,
      url: String(checkpoint.ref.url ?? CLAUDE_URLS.newChat),
      ...(endpoint ? { endpoint } : {}),
      lastMessage: "",
      savedAt: checkpoint.savedAt,
    });
    sessions.set(String(checkpoint.ref.sessionId ?? checkpoint.adapterId), driver);
    return {
      id: String(checkpoint.ref.sessionId ?? checkpoint.adapterId),
      adapterId: "claude-web",
      ref: { ...checkpoint.ref },
    };
  }

  async sendControl(session: BrainSession, message: ControlMessage): Promise<void> {
    const driver = sessions.get(session.id);
    if (!driver) throw new Error("Claude session is not open.");
    await driver.send(encodeControlMessage(message));
  }

  async awaitControl(session: BrainSession): Promise<ControlMessage> {
    const driver = sessions.get(session.id);
    if (!driver) throw new Error("Claude session is not open.");
    for (;;) {
      const reply = await driver.awaitReply();
      const parsed = parseControlBlock(reply);
      if (parsed.ok) return parsed.message;
      await driver.send("Reply with a single [A2L] control block only.");
    }
  }

  async verifyWorkspace(
    _session: BrainSession,
    workspace: { workspaceId: string; root: string }
  ): Promise<VerificationResult> {
    const store = new AuthStore(workspace.workspaceId);
    const tokens = store.tokenCount();
    return {
      verified: tokens > 0,
      method: "oauth-token-count",
      message:
        tokens > 0
          ? `Claude holds ${tokens} active MCP token(s) for workspace ${workspace.workspaceId}.`
          : `No MCP token issued for workspace ${workspace.workspaceId}.`,
      details: { tokenCount: tokens },
    };
  }

  async close(session: BrainSession): Promise<void> {
    const driver = sessions.get(session.id);
    if (driver) {
      await driver.close().catch(() => undefined);
      sessions.delete(session.id);
    }
  }

  static reset(): void {
    clearWebRef("claude-web");
    sessions.clear();
  }
}

export function createClaudeWebBrain(): ClaudeWebBrain {
  return new ClaudeWebBrain();
}
