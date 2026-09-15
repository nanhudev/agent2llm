/**
 * The control channel: validated send/receive between Core and a Brain.
 *
 * Every message passes through the protocol machine exactly once, and every
 * accepted transition emits a state-changed event. Nothing here knows what a
 * ChatGPT or Claude conversation looks like.
 */
import {
  createControlMessage,
  type A2LPayload,
  type A2LState,
  type ControlMessage,
} from "@agent2llm/protocol";
import {
  createEvent,
  createStateChangedEvent,
  isTransientError,
  withRetry,
  type EventSink,
} from "@agent2llm/core";
import type { BrainAdapter, BrainSession, UserActionRequest } from "@agent2llm/adapter-sdk";
import type { Logger } from "@agent2llm/logger";
import type { ProtocolMachine } from "./machine.js";
import { persistFromMessage } from "./persistence.js";
import type { SessionStore } from "@agent2llm/session";

export interface ControlChannelDeps {
  brain: BrainAdapter;
  session: BrainSession;
  machine: ProtocolMachine;
  sessions: SessionStore;
  logger: Logger;
  emit: EventSink;
  signal?: AbortSignal;
  requestUserAction?: (action: UserActionRequest) => Promise<void>;
}

export class ControlChannel {
  constructor(private readonly deps: ControlChannelDeps) {}

  /** Sends a Core-originated message, with bounded retry on transient faults. */
  async send<K extends A2LState>(type: K, payload: A2LPayload[K], iteration: number): Promise<void> {
    const message = createControlMessage(type, payload, {
      sessionId: this.deps.machine.sessionId,
      taskId: this.deps.machine.taskId,
      workspaceId: this.deps.machine.workspaceId,
      iteration,
      sender: { role: "core", adapter: "core" },
    });
    await this.sendMessage(message);
  }

  async sendMessage(message: ControlMessage): Promise<void> {
    this.deps.machine.validate(message);
    await withRetry(() => this.deps.brain.sendControl(this.deps.session, message), {
      maxAttempts: 3,
      signal: this.deps.signal,
      onRetry: ({ attempt, error, delayMs }) =>
        this.deps.logger.warn(`Control send failed (attempt ${attempt}, retry in ${delayMs}ms): ${error.message}`),
    });
    this.afterAccepted(message);
    this.deps.emit(
      createEvent({
        kind: "CONTROL_SENT",
        message: `${message.type} -> ${this.deps.brain.metadata().id}`,
        sessionId: message.sessionId,
        taskId: message.taskId,
        iteration: message.iteration,
      })
    );
  }

  /**
   * Waits for one of `allowed`. Unexpected states are logged and skipped
   * rather than silently accepted.
   */
  async receive(allowed: readonly A2LState[]): Promise<ControlMessage> {
    for (;;) {
      let message: ControlMessage;
      try {
        message = await this.deps.brain.awaitControl(this.deps.session, { signal: this.deps.signal });
      } catch (error) {
        if (isTransientError(error) && !this.deps.signal?.aborted) {
          await this.deps.requestUserAction?.({
            kind: "open-url",
            message: `Waiting for ${this.deps.brain.metadata().name} failed: ${(error as Error).message}`,
          });
          continue;
        }
        throw error;
      }
      this.deps.emit(
        createEvent({
          kind: "CONTROL_RECEIVED",
          message: `${message.type} from ${message.sender.adapter}`,
          sessionId: message.sessionId,
          taskId: message.taskId,
          iteration: message.iteration,
        })
      );
      this.afterAccepted(message);
      if (!allowed.includes(message.type)) {
        this.deps.logger.warn(`Ignoring unexpected ${message.type} while waiting for ${allowed.join("/")}`);
        continue;
      }
      persistFromMessage(this.deps.sessions, message);
      return message;
    }
  }

  private afterAccepted(message: ControlMessage): void {
    const accepted = this.deps.machine.apply(message);
    this.deps.emit(
      createStateChangedEvent(accepted.from, accepted.to, {
        sessionId: message.sessionId,
        taskId: message.taskId,
        iteration: message.iteration,
      })
    );
  }
}
