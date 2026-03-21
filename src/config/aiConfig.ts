/**
 * Configuration for AI Context and Token Management
 * Fine-tune these variables to balance between memory (context) and token usage.
 */
export const AI_CONFIG = {
  // --- Message Context ---
  /** Number of recent messages to include in full detail */
  MAX_FULL_MESSAGES: 20,
  /** Interval at which to create a summary of older messages */
  MESSAGE_SUMMARY_INTERVAL: 20,

  // --- Session Context ---
  /** Number of recent session summaries to include */
  MAX_RECENT_SESSION_SUMMARIES: 10,
  /** Number of shared personal session summaries to include in couple sessions */
  MAX_SHARED_PERSONAL_SUMMARIES: 3,
  /** Interval at which to create a meta-summary of older sessions */
  SESSION_META_SUMMARY_INTERVAL: 10,

  // --- Other Context ---
  /** Whether to include the very last homework task */
  INCLUDE_LAST_HOMEWORK: true,
  
  // --- AI Model Settings ---
  MODEL_NAME: "gemini-1.5-flash",
  DEFAULT_TEMPERATURE: 0.7,
  SUMMARY_TEMPERATURE: 0.3, // Lower temperature for more factual summaries
};
