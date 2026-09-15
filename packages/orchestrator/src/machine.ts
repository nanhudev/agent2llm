import {
  A2L_MUTABLE_STATES,
  canTransition,
  isA2LState,
  validateTransition,
  type A2LState,
} from "@agent2llm/protocol";
import type { ControlMessage } from "@agent2llm/protocol";
import { protocolViolation } from "@agent2llm/core";

/**
 * The single authority for protocol state.
 *
 * Every transition is validated here, never in an adapter and never in the
 * CLI. This is what makes the protocol testable without any third-party
 * product installed.
 */
export interface MachineContext {
  sessionId: string;
  taskId: string;
  workspaceId: string;
}

export interface Accepted {
  from: A2LState;
  to: A2LState;
}

export class ProtocolMachine {
  private state: A2LState = "BOOTSTRAP";
  private iteration = 0;

  constructor(private readonly context: MachineContext) {}

  get current(): A2LState {
    return this.state;
  }

  get currentIteration(): number {
    return this.iteration;
  }

  get sessionId(): string {
    return this.context.sessionId;
  }

  get taskId(): string {
    return this.context.taskId;
  }

  get workspaceId(): string {
    return this.context.workspaceId;
  }

  /**
   * Validate a control message against the current state *and* the session
   * identity. Nothing is applied unless every rule passes.
   */
  validate(message: ControlMessage): void {
    if (message.sessionId !== this.context.sessionId) {
      throw protocolViolation(
        `Control message belongs to session ${message.sessionId}, expected ${this.context.sessionId}.`,
        { details: { expected: this.context.sessionId, got: message.sessionId } }
      );
    }
    if (message.taskId !== this.context.taskId) {
      throw protocolViolation(
        `Control message belongs to task ${message.taskId}, expected ${this.context.taskId}.`,
        { details: { expected: this.context.taskId, got: message.taskId } }
      );
    }
    if (message.workspaceId !== this.context.workspaceId) {
      throw protocolViolation(
        `Control message targets workspace ${message.workspaceId}, expected ${this.context.workspaceId}.`,
        { details: { expected: this.context.workspaceId, got: message.workspaceId } }
      );
    }
    if (message.iteration < this.iteration) {
      throw protocolViolation(
        `Control message iteration ${message.iteration} goes backwards from ${this.iteration}.`,
        { details: { current: this.iteration, got: message.iteration } }
      );
    }
    if (!isA2LState(message.type)) {
      throw protocolViolation(`Unknown protocol state '${String(message.type)}'.`, {
        details: { got: String(message.type) },
      });
    }
    // A completed task may only hand off; it may never mutate the workspace.
    if (this.state === "DONE" && message.type !== "HANDOFF") {
      throw protocolViolation("A DONE task cannot transition anywhere except HANDOFF.", {
        details: { from: this.state, to: message.type },
      });
    }
    // Mutation states are entered by the core, never claimed by a message.
    if (A2L_MUTABLE_STATES.includes(message.type) && message.sender.role !== "core") {
      throw protocolViolation(
        `Only the core may enter the mutation state ${message.type}.`,
        { details: { sender: message.sender } }
      );
    }
    const verdict = validateTransition(this.state, message.type);
    if (!verdict.ok) {
      throw protocolViolation(verdict.message, {
        details: { from: this.state, to: message.type, reason: verdict.reason },
      });
    }
  }

  apply(message: ControlMessage): Accepted {
    this.validate(message);
    const from = this.state;
    this.state = message.type;
    if (message.iteration > this.iteration) this.iteration = message.iteration;
    return { from, to: this.state };
  }

  /** Core-driven transitions (DISPATCHED / EXECUTING / EXECUTED). */
  force(to: A2LState): Accepted {
    if (!canTransition(this.state, to)) {
      throw protocolViolation(`Illegal core transition: ${this.state} -> ${to}.`, {
        details: { from: this.state, to },
      });
    }
    const from = this.state;
    this.state = to;
    return { from, to };
  }

  nextIteration(): number {
    return this.iteration + 1;
  }

  /** Used by REVISE: bump the iteration counter for the next round. */
  bump(): number {
    this.iteration += 1;
    return this.iteration;
  }
}
