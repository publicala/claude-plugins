// What the artifact viewer offers the page through window.claude. Either
// capability may be missing, and every call may reject with a `code`.

export type Sample = (
  prompt: string,
  options: { modelTier: string; cache: boolean },
) => Promise<{ text: string }>;

export interface Comments {
  canSendToClaude(): Promise<string>;
  anchorFor(element: HTMLElement): Promise<unknown>;
  sendToClaude(message: { anchor: unknown; text: string }): Promise<unknown>;
}

interface ClaudeHost {
  use?: {
    (capability: "sample"): Promise<Sample | null | undefined>;
    (capability: "comments"): Promise<Comments | null | undefined>;
  };
}

declare global {
  interface Window {
    claude?: ClaudeHost;
  }
}

/** The `code` a host call rejected with, if any. */
export const errorCode = (error: unknown): unknown =>
  typeof error === "object" && error !== null && "code" in error
    ? error.code
    : undefined;
