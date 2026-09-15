import { z } from "zod";
import { A2L_STATES } from "@agent2llm/protocol";

/**
 * Collaboration session model.
 *
 * Sessions store protocol state, ids, short text fields and adapter-owned
 * opaque refs. They never store credentials, file bodies, diffs or logs —
 * a resume must be possible without replaying content.
 */
export const sessionCheckpointSchema = z.object({
  goal: z.string().max(500),
  progress: z.array(z.string().max(300)).max(12).default([]),
  knownIssues: z.array(z.string().max(300)).max(12).default([]),
  nextExpectedStep: z.string().max(400).default(""),
  currentState: z.string().max(300).default(""),
});

export type SessionCheckpoint = z.infer<typeof sessionCheckpointSchema>;

export const adapterRefSchema = z.object({
  adapterId: z.string().min(1).max(64),
  ref: z.record(z.unknown()).default({}),
  savedAt: z.string(),
});

export type AdapterRef = z.infer<typeof adapterRefSchema>;

export const sessionIssueSchema = z.object({
  at: z.string(),
  iteration: z.number().int().nonnegative(),
  code: z.string().max(80),
  message: z.string().max(500),
});

export type SessionIssue = z.infer<typeof sessionIssueSchema>;

export const collaborationSessionSchema = z.object({
  sessionId: z.string().min(1),
  taskId: z.string().min(1),
  workspaceId: z.string().min(1),
  brainAdapterId: z.string().min(1),
  brainSession: adapterRefSchema.nullable(),
  harnessAdapterId: z.string().min(1),
  harnessSession: adapterRefSchema.nullable(),
  workflowId: z.string().min(1).default("brain-hands"),
  goal: z.string().min(1).max(1000),
  iteration: z.number().int().nonnegative().default(0),
  protocolState: z.enum(A2L_STATES).default("BOOTSTRAP"),
  maxIterations: z.number().int().min(1).max(50).default(12),
  checkpoint: sessionCheckpointSchema.nullable().default(null),
  issues: z.array(sessionIssueSchema).max(50).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  finishedAt: z.string().nullable().default(null),
});

export type CollaborationSession = z.infer<typeof collaborationSessionSchema>;

export interface CreateSessionInput {
  sessionId: string;
  taskId: string;
  workspaceId: string;
  brainAdapterId: string;
  harnessAdapterId: string;
  goal: string;
  workflowId?: string;
  maxIterations?: number;
}

export function createSession(input: CreateSessionInput): CollaborationSession {
  const now = new Date().toISOString();
  return collaborationSessionSchema.parse({
    sessionId: input.sessionId,
    taskId: input.taskId,
    workspaceId: input.workspaceId,
    brainAdapterId: input.brainAdapterId,
    brainSession: null,
    harnessAdapterId: input.harnessAdapterId,
    harnessSession: null,
    workflowId: input.workflowId ?? "brain-hands",
    goal: input.goal,
    iteration: 0,
    protocolState: "BOOTSTRAP",
    maxIterations: input.maxIterations ?? 12,
    checkpoint: null,
    issues: [],
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
  });
}

export function touchSession(session: CollaborationSession): CollaborationSession {
  return { ...session, updatedAt: new Date().toISOString() };
}

export function isFinished(session: CollaborationSession): boolean {
  return session.finishedAt !== null;
}
