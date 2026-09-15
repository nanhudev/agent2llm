import { A2LError } from "./errors.js";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Short, URL-safe, collision-resistant identifiers (no crypto dependency). */
export function randomId(bytes = 8): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let out = "";
  for (const byte of buffer) {
    out += ALPHABET[byte % ALPHABET.length];
    out += ALPHABET[Math.floor(byte / ALPHABET.length)];
  }
  return out;
}

export function newId(prefix: string, bytes = 8): string {
  return `${prefix}_${randomId(bytes)}`;
}

export const newSessionId = (): string => newId("a2ls", 8);
export const newTaskId = (): string => newId("a2lt", 6);
export const newWorkspaceId = (): string => newId("a2lw", 6);
export const newExecutionId = (): string => newId("a2lx", 6);

export function assertValidId(value: string, kind: string): void {
  if (!/^[a-z0-9]+_[a-z0-9]{6,32}$/.test(value)) {
    throw new A2LError(`Invalid ${kind} id: ${value}`, { code: "ProtocolViolation" });
  }
}
