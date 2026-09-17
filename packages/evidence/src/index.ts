/**
 * `@agent2llm/evidence` — verified execution evidence.
 *
 * The collector reads the repository; the compressor decides how much of that
 * reaches the Brain. Keeping them together is the point: compression is only
 * safe because the thing being compressed was verified first, and the
 * verification is what the Brain is told about.
 */
export * from "./git.js";
export * from "./collect.js";
export * from "./compress.js";
