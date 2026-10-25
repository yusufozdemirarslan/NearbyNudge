/**
 * The product's one outside API, as the public legal pages (Data sources,
 * Privacy) must describe it. The API only exposes the AI's display name and
 * model id (GET /api/status), not the vendor, so this is the one place in
 * the app that names the vendor. Update it if the backend's AI changes.
 * Everywhere else, name the AI with `useAiName()`.
 */
export const AI_PROVIDER = {
  /** The model, as people know it. */
  product: "Claude Sonnet 5.5",
  /** The company that runs it. */
  vendor: "Anthropic",
  /** How the vendor treats data sent through its API. */
  training:
    "Anthropic does not use data sent through its API to train its models by default.",
} as const
