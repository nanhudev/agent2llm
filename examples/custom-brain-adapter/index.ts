/**
 * Minimal custom Brain adapter.
 *
 * Copy this into `@agent2llm/brain-my-brain` and fill in only what your Brain
 * really does. Declare missing capabilities; do not fake them.
 */
import { BrainAdapterBase } from "@agent2llm/adapter-sdk";
import type {
  BrainSession,
  BrainSessionContext,
  CapabilityManifest,
  ControlMessage,
  SetupResult,
} from "@agent2llm/adapter-sdk";

export class MyBrainAdapter extends BrainAdapterBase {
  metadata() {
    return {
      id: "my-brain",
      name: "My Brain",
      version: "0.1.0",
      role: "brain" as const,
    };
  }

  override async capabilities(): Promise<CapabilityManifest> {
    return this.emptyManifestFor("rpc", [
      "session.create",
      "conversation.send",
      "conversation.receive",
      "plan.generate",
      "review.perform",
      "workspace.read",
      // A Brain never declares workspace.write, shell.execute or git.modify.
    ]);
  }

  override async setup(): Promise<SetupResult> {
    return { ok: true, status: "configured" };
  }

  override async createSession(ctx: BrainSessionContext): Promise<BrainSession> {
    return { id: ctx.sessionId, adapterId: this.metadata().id, ref: { sessionId: ctx.sessionId } };
  }

  override async sendControl(_session: BrainSession, _message: ControlMessage): Promise<void> {
    // Deliver the control message to your Brain.
  }

  override async awaitControl(_session: BrainSession): Promise<ControlMessage> {
    // Return the next A2L control message from your Brain.
    throw new Error("Not implemented in this example");
  }
}
