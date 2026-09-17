/**
 * What a CLI Harness adapter declares about the product it drives.
 *
 * Split out from the runtime so the *description* of a product can be read
 * without reading the machinery that uses it. Everything here is data the
 * concrete adapter supplies; nothing here executes.
 */
export interface CliHarnessProfile {
  id: string;
  name: string;
  bin: string;
  /** Alternate binary names (e.g. `agent` for `cursor-agent`). */
  altBins?: readonly string[];
  vendor?: string;
  homepage?: string;
  /** Extra installation locations probed beyond PATH. */
  candidates?: readonly string[];
  /**
   * Product-owned directories holding versioned binaries; the newest match for
   * `versionedPattern` wins. Codex Desktop stages its CLI this way.
   */
  versionedDirs?: readonly string[];
  versionedPattern?: RegExp;
  /**
   * Subcommand whose `--help` advertises the real flag surface, when the
   * top-level help only points at subcommands (e.g. `codex exec --help`).
   */
  helpSubcommand?: string;
  experimental?: boolean;
  /** Product this adapter drives, shown by `agent2llm adapters`. */
  drives?: string;
}
