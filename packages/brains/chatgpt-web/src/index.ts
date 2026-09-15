/**
 * ChatGPT Web Brain adapter.
 *
 * C2C proved that a chat box can carry a control plane. This adapter keeps
 * that idea and generalises it: nothing here is Codex-specific, and the
 * browser is driven by the Core transport abstraction rather than by the
 * adapter itself.
 *
 * Status honesty: `implemented` is always true. `detected` depends on a saved
 * conversation and (optionally) Playwright. `verified` is only true after a
 * real round trip has succeeded in this installation.
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
import { probeBrowserModule } from "@agent2llm/transports";
import {
  WebBrainSession,
  clearWebRef,
  loadWebRef,
  resolveTransportMode,
} from "@agent2llm/brain-web-runtime";
import { buildChatGPTBootPrompt, buildTurnReminder } from "./boot-prompt.js";
import { CHATGPT_SELECTORS, CHATGPT_URLS, isConversationUrl } from "./selectors.js";

interface SessionState {
  driver: WebBrainSession;
  booted: boolean;
  url: string;
  mode: "playwright" | "manual";
}

const sessions = new Map<string, SessionState>();

export class ChatGPTWebBrain extends BaseBrainAdapter {
  metadata(): AdapterMetadata {
    return {
      id: "chatgpt-web",
      name: "ChatGPT",
      version: "0.1.0",
      role: "brain",
      vendor: "OpenAI",
      homepage: "https://chatgpt.com",
      experimental: true,
    };
  }

  async detect(ctx: DetectContext = {}): Promise<DetectionResult> {
    const saved = loadWebRef("chatgpt-web");
    const browser = probeBrowserModule();
    const notes: string[] = [];
    if (!browser.installed) {
      notes.push("Playwright is not installed; the manual transport will be used.");
    }
    if (!saved) {
      return {
        status: "implemented",
        reason: "No saved ChatGPT conversation yet. Run `agent2llm setup --brain chatgpt-web`.",
        notes,
      };
    }
    if (!isConversationUrl(saved.url)) {
      return { status: "configured", version: null, reason: `Saved URL ${saved.url} is not a conversation.`, notes };
    }
    return {
      status: "configured",
      reason: `Saved conversation ${saved.url} (${saved.mode} transport).`,
      notes,
    };
  }

  async buildCapabilities(): Promise<CapabilityManifest> {
    const browser = probeBrowserModule();
    const base = withCapabilities(emptyManifest(browser.installed ? "browser" : "manual"), [
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
      "supportsHeadless",
    ]);
    return {
      ...base,
      experimental: true,
      transport: browser.installed ? "browser" : "manual",
      // No native JSON mode over the chat UI: control messages are parsed
      // from a strict text block. That is a real limitation, declared here.
      capabilities: {
        ...base.capabilities,
        structuredOutput: {
          supported: true,
          level: "partial",
          experimental: false,
          notes: "Text [A2L] block, not JSON.",
        },
      },
      limitations: [
        "Control messages are parsed from a text block typed in the chat UI; no native structured-output channel.",
        "DOM selectors are version-sensitive and may need updating when ChatGPT changes its UI.",
        "Login, CAPTCHA and 2FA must be completed by the human in the official interface.",
      ],
      auth: { required: true, authenticated: false, method: "official web login + OAuth 2.1 MCP pairing" },
      facts: {
        playwrightInstalled: browser.installed,
        transport: browser.installed ? "browser" : "manual",
      },
    };
  }

  override async setup(ctx: SetupContext): Promise<SetupResult> {
    const saved = loadWebRef("chatgpt-web");
    if (saved && isConversationUrl(saved.url)) {
      return { ok: true, status: "configured", message: `Reusing conversation ${saved.url}.` };
    }
    if (!ctx.requestUserAction) {
      return {
        ok: false,
        status: "configured",
        message: "A browser action is required but no interactive handler is available.",
      };
    }
    // ONE action at a time, inherited from C2C's UX rule.
    await ctx.requestUserAction({
      kind: "open-url",
      message: `Open the Agent2LLM MCP connector page and add the workspace connector for '${ctx.workspaceId}'.`,
      url: CHATGPT_URLS.connectors,
    });
    await ctx.requestUserAction({
      kind: "login",
      message: "Open a new ChatGPT conversation in the browser window, then continue.",
      url: CHATGPT_URLS.newChat,
    });
    return {
      ok: true,
      status: "configured",
      message: "ChatGPT connector configured. The conversation URL will be saved on first use.",
    };
  }

  async createSession(ctx: BrainSessionContext): Promise<BrainSession> {
    const mode = resolveTransportMode(
      {
        adapterId: "chatgpt-web",
        displayName: "ChatGPT",
        newConversationUrl: CHATGPT_URLS.newChat,
        conversationUrlPrefix: CHATGPT_URLS.base,
        connectorUrl: CHATGPT_URLS.connectors,
        selectors: CHATGPT_SELECTORS,
      },
      undefined
    );
    const driver = new WebBrainSession(
      {
        adapterId: "chatgpt-web",
        displayName: "ChatGPT",
        newConversationUrl: CHATGPT_URLS.newChat,
        conversationUrlPrefix: CHATGPT_URLS.base,
        connectorUrl: CHATGPT_URLS.connectors,
        selectors: CHATGPT_SELECTORS,
      },
      mode
    );
    const ref = await driver.open(CHATGPT_URLS.newChat);
    await driver.send(
      buildChatGPTBootPrompt({
        workspaceId: ctx.workspaceId,
        workspaceName: ctx.workspaceId,
        sessionId: ctx.sessionId,
        taskId: ctx.taskId,
        goal: ctx.goal,
        workflowId: "brain-hands",
        maxWebBytes: 1024,
      })
    );
    const session: BrainSession = {
      id: ctx.sessionId,
      adapterId: "chatgpt-web",
      ref: { url: ref.url, mode: ref.mode },
    };
    sessions.set(ctx.sessionId, { driver, booted: true, url: ref.url, mode: ref.mode });
    return session;
  }

  async attachSession(checkpoint: BrainCheckpoint): Promise<BrainSession> {
    const url = typeof checkpoint.ref.url === "string" ? checkpoint.ref.url : CHATGPT_URLS.newChat;
    const mode = checkpoint.ref.mode === "manual" ? "manual" : "playwright";
    const driver = new WebBrainSession(
      {
        adapterId: "chatgpt-web",
        displayName: "ChatGPT",
        newConversationUrl: CHATGPT_URLS.newChat,
        conversationUrlPrefix: CHATGPT_URLS.base,
        connectorUrl: CHATGPT_URLS.connectors,
        selectors: CHATGPT_SELECTORS,
      },
      mode
    );
    await driver.attach({
      mode,
      url,
      lastMessage: "",
      savedAt: checkpoint.savedAt,
    });
    return { id: checkpoint.adapterId, adapterId: "chatgpt-web", ref: { url, mode } };
  }

  async sendControl(session: BrainSession, message: ControlMessage): Promise<void> {
    const state = this.stateFor(session);
    const text =
      message.type === "INIT"
        ? `${encodeControlMessage(message)}\n\n${buildChatGPTBootPrompt({
            workspaceId: message.workspaceId,
            workspaceName: message.workspaceId,
            sessionId: message.sessionId,
            taskId: message.taskId,
            goal: String((message.payload as { goal?: string }).goal ?? ""),
            workflowId: "brain-hands",
            maxWebBytes: 1024,
          })}`
        : `${encodeControlMessage(message)}\n\n${buildTurnReminder(message.iteration)}`;
    await state.driver.send(text);
  }

  async awaitControl(session: BrainSession): Promise<ControlMessage> {
    const state = this.stateFor(session);
    for (;;) {
      const reply = await state.driver.awaitReply();
      const parsed = parseControlBlock(reply);
      if (parsed.ok) return parsed.message;
      // The Brain answered in prose: ask once for a control block, then keep waiting.
      await state.driver.send(
        "Reply with a single [A2L] control block only. Do not include prose outside the block."
      );
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
          ? `ChatGPT holds ${tokens} active MCP token(s) for workspace ${workspace.workspaceId}.`
          : `No MCP token issued for workspace ${workspace.workspaceId}. Complete pairing first.`,
      details: { workspaceId: workspace.workspaceId, tokenCount: tokens },
    };
  }

  async close(session: BrainSession): Promise<void> {
    const state = sessions.get(session.id);
    if (state) {
      await state.driver.close().catch(() => undefined);
      sessions.delete(session.id);
    }
  }

  /** Test helper: forget the saved conversation URL. */
  static reset(): void {
    clearWebRef("chatgpt-web");
    sessions.clear();
  }

  private stateFor(session: BrainSession): SessionState {
    const state = sessions.get(session.id);
    if (!state) {
      // Reconstruct from ref so a restarted process can still send/receive.
      const mode = session.ref.mode === "manual" ? "manual" : "playwright";
      const driver = new WebBrainSession(
        {
          adapterId: "chatgpt-web",
          displayName: "ChatGPT",
          newConversationUrl: CHATGPT_URLS.newChat,
          conversationUrlPrefix: CHATGPT_URLS.base,
          connectorUrl: CHATGPT_URLS.connectors,
          selectors: CHATGPT_SELECTORS,
        },
        mode
      );
      const created: SessionState = {
        driver,
        booted: true,
        url: String(session.ref.url ?? CHATGPT_URLS.newChat),
        mode,
      };
      sessions.set(session.id, created);
      return created;
    }
    return state;
  }
}

export function createChatGPTWebBrain(): ChatGPTWebBrain {
  return new ChatGPTWebBrain();
}
