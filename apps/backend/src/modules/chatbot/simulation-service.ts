import prisma from "../../lib/prisma";
import redis from "../../lib/redis";
import { AIService } from "../ai/service";
import { APIToolsService, type APIToolRecord } from "../api-tools/service";
import { KnowledgeService } from "../knowledge/service";
import {
  AIResponseLogService,
  type AiResponseLogEntrypoint,
  type KnowledgeReferenceLog,
  type RtkSummaryLog,
} from "./response-log-service";

type ChatbotSnapshot = {
  id: string;
  app_id: string;
  name: string;
  model: string | null;
  prompt: string | null;
  welcome_msg: string | null;
  agent_transfer: string | null;
  temperature: unknown;
  history_limit: number | null;
  context_limit: number | null;
  max_file_read_window: number | null;
  message_limit: number | null;
  session_only_memory: boolean | null;
  timezone: string | null;
  label_condition: string | null;
  selected_labels: unknown;
  app_data: unknown;
  ai_followups: unknown;
  plugin_data: unknown;
};

type NormalizedHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type KnowledgeContextItem = {
  type: "faq" | "source";
  id?: string;
  title: string;
  content: string;
  score: number;
  keywordScore?: number;
  vectorScore?: number;
};

type ToolExecutionResult = {
  toolId: string;
  toolName: string;
  method: string;
  url: string;
  ok: boolean;
  skipped: boolean;
  status: number | null;
  error: string | null;
  responsePreview: string | null;
};

type SimulateChatbotResponseInput = {
  chatbot: ChatbotSnapshot;
  appId: string;
  message: string;
  history?: unknown;
  runTools?: boolean;
  strictFollowup?: boolean;
  mode: "simulate" | "live";
  entrypoint?: AiResponseLogEntrypoint;
  conversationId?: string | null;
  sourceMessageIds?: string[];
  skipRag?: boolean;
  allowAllKnowledge?: boolean;
  minimalContext?: boolean;
};

type SimulationPreviewTimelineItem =
  | {
      type: "status";
      text: string;
    }
  | {
      type: "text";
      role: "assistant";
      content: string;
    }
  | {
      type: "image";
      role: "assistant";
      url: string;
      alt: string | null;
    };

export type SimulateChatbotResponseResult = {
  content: string;
  meta: {
    ai_agent_id: string;
    ai_agent_name: string;
    is_ai: true;
    ai_generated: true;
    generated_by_ai: true;
    ai_source: string;
    provider: string | null;
    ai_provider_hit: boolean;
    ai_provider_endpoint: string | null;
    ai_provider_status_code: number | null;
    ai_provider_error: string | null;
    ai_fallback_reason: string | null;
    knowledge_hits: number;
    tools_called: number;
    tools_succeeded: number;
    followups_matched: number;
    label_applied_id: string | null;
    label_applied: string | null;
    credits_used: number;
    mode: "simulate" | "live";
    ai_response_log_id: string | null;
    ai_tokens_prompt: number;
    ai_tokens_completion: number;
    ai_tokens_total: number;
    ai_cost_credits: number;
    ai_cost_usd: number;
    ai_cost_idr: number;
    ai_knowledge_references: KnowledgeReferenceLog[];
    ai_rtk_summary: RtkSummaryLog;
    knowledge_snapshot_at: string;
    rag_intent?: string | null;
    rag_profile?: Record<string, unknown>;
  };
  preview: {
    timeline: SimulationPreviewTimelineItem[];
    credits_used: number;
  };
};

type UsageStats = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

type ModelResponseTrace = {
  endpoint: string | null;
  status_code: number | null;
  hit: boolean;
  error: string | null;
};

type ModelResponseResult = {
  content: string | null;
  usage: UsageStats;
  trace: ModelResponseTrace;
};

type ProviderRuntime = {
  provider: string | null;
  baseUrl: string | null;
  apiKey: string | null;
  apiVersion: string | null;
  deploymentName: string | null;
  modelName: string;
  temperature: number;
  maxTokens: number;
};

type RetrievalIntent =
  | "price_promo"
  | "location"
  | "service_catalog"
  | "treatment"
  | "general";

type RetrievalProfile = {
  intent: RetrievalIntent;
  keywordBoost: number;
  vectorBoost: number;
  minTotalScore: number;
  minKeywordOverlap: number;
  minVectorSimilarity: number;
  liveContextItemCap: number;
  liveCharBudget: number;
  liveMaxItemChars: number;
};

function estimateMinResponseTokensFromChars(charLimit: number): number {
  const boundedChars = clampNumber(charLimit, 1_200, 80, 5_000);
  const estimated = Math.ceil(boundedChars / 3.5);
  return clampNumber(estimated, 320, 128, 4_096);
}

const TOOL_TIMEOUT_MS = clampNumber(
  process.env.AI_TOOL_TIMEOUT_MS,
  12_000,
  1_000,
  60_000,
);
const MAX_SIMULATED_TOOL_CALLS = clampNumber(
  process.env.AI_SIMULATION_MAX_TOOL_CALLS,
  3,
  1,
  8,
);
const LLM_TIMEOUT_MS = clampNumber(
  process.env.AI_LLM_TIMEOUT_MS,
  25_000,
  1_000,
  120_000,
);
const AI_AGENT_HISTORY_LIMIT_MAX = clampNumber(
  process.env.AI_AGENT_HISTORY_LIMIT_MAX,
  50,
  1,
  500,
);
const AI_AGENT_CONTEXT_LIMIT_MAX = clampNumber(
  process.env.AI_AGENT_CONTEXT_LIMIT_MAX,
  100,
  1,
  500,
);
const AI_AGENT_READ_FILE_LIMIT_MAX = clampNumber(
  process.env.AI_AGENT_READ_FILE_LIMIT_MAX,
  20,
  1,
  200,
);
const AI_REPLY_CHAR_LIMIT_DEFAULT = clampNumber(
  process.env.AI_REPLY_CHAR_LIMIT_DEFAULT,
  3_500,
  300,
  12_000,
);
const RAG_KNOWLEDGE_CACHE_TTL_SECONDS = clampNumber(
  process.env.RAG_KNOWLEDGE_CACHE_TTL_SECONDS,
  120,
  10,
  900,
);
const RAG_VECTOR_TOP_K = clampNumber(process.env.RAG_VECTOR_TOP_K, 80, 5, 200);
const RAG_VECTOR_SIMILARITY_BOOST = clampNumber(
  process.env.RAG_VECTOR_SIMILARITY_BOOST,
  10,
  1,
  30,
);
const RAG_KEYWORD_SCORE_BOOST = clampNumber(
  process.env.RAG_KEYWORD_SCORE_BOOST,
  3,
  1,
  10,
);
const RAG_MIN_TOTAL_SCORE = clampNumber(
  process.env.RAG_MIN_TOTAL_SCORE,
  3,
  0,
  50,
);
const RAG_MIN_KEYWORD_OVERLAP = clampNumber(
  process.env.RAG_MIN_KEYWORD_OVERLAP,
  1,
  0,
  10,
);
const RAG_MIN_VECTOR_SIMILARITY = clampNumber(
  process.env.RAG_MIN_VECTOR_SIMILARITY,
  0.3,
  0,
  1,
);
const RAG_LIVE_CONTEXT_ITEM_CAP = clampNumber(
  process.env.RAG_LIVE_CONTEXT_ITEM_CAP,
  20,
  4,
  40,
);
const RAG_LIVE_CHAR_BUDGET = clampNumber(
  process.env.RAG_LIVE_CHAR_BUDGET,
  24_000,
  4_000,
  36_000,
);
const RAG_LIVE_MAX_ITEM_CHARS = clampNumber(
  process.env.RAG_LIVE_MAX_ITEM_CHARS,
  2_600,
  600,
  3_600,
);
const ENABLE_GLOBAL_KNOWLEDGE_COVERAGE = /^(1|true|yes|on)$/i.test(
  String(process.env.ENABLE_GLOBAL_KNOWLEDGE_COVERAGE || "false"),
);
const RAG_ACCURACY_FIRST_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.RAG_ACCURACY_FIRST_ENABLED || "true"),
);
const ENABLE_STRICT_TREATMENT_PRICE_FORMATTER = /^(1|true|yes|on)$/i.test(
  String(process.env.ENABLE_STRICT_TREATMENT_PRICE_FORMATTER || "false"),
);
const ENABLE_INLINE_IMAGE_TARGET_NORMALIZER = /^(1|true|yes|on)$/i.test(
  String(process.env.ENABLE_INLINE_IMAGE_TARGET_NORMALIZER || "false"),
);
const RAG_CACHE_PREFIX = "rag:knowledge:";

const MODEL_CREDIT_FALLBACK: Record<string, number> = {
  standard: 9,
  basic: 7,
  standard_plus_a: 7,
  standard_plus_b: 7,
  standard_plus_c: 7,
  standard_plus: 28,
  advanced: 173,
  advanced_plus: 139,
  advanced_thinking: 77,
  standard_vision: 21,
  advanced_vision: 21,
  advanced_v4: 87,
  standard_v4: 18,
  gpt_4o_mini: 9,
  gpt_4o: 25,
};

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({ ...(item as Record<string, unknown>) }));
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item || "").trim()).filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeToolLookupKey(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toBooleanFlag(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on", "active"].includes(normalized)) return true;
    if (["false", "0", "no", "off", "inactive"].includes(normalized))
      return false;
  }
  return fallback;
}

type NormalizedAgentToolCard = {
  id: string | null;
  lookupName: string | null;
  isActive: boolean;
  priority: number;
};

function normalizeAgentToolCards(value: unknown): NormalizedAgentToolCard[] {
  return toRecordArray(value)
    .map((card, index) => {
      const id = toNullableString(card.id);
      const name = toNullableString(card.name);
      const lookupName = name ? normalizeToolLookupKey(name) : null;
      if (!id && !lookupName) return null;
      return {
        id,
        lookupName,
        isActive: toBooleanFlag(card.is_active, false),
        priority: index,
      };
    })
    .filter((item): item is NormalizedAgentToolCard => item !== null);
}

function isToolExecutionEnabledByLimit(maxToolCalls: number | null): boolean {
  if (typeof maxToolCalls !== "number") return true;
  return maxToolCalls > 0;
}

function resolveCandidateTools(args: {
  availableTools: APIToolRecord[];
  configuredCardsRaw: unknown;
}): APIToolRecord[] {
  const enabledTools = args.availableTools.filter((tool) =>
    isToolExecutionEnabledByLimit(tool.max_tool_calls),
  );

  const configuredCards = normalizeAgentToolCards(args.configuredCardsRaw);
  if (configuredCards.length === 0) return [];

  const activeCards = configuredCards.filter((card) => card.isActive);
  if (activeCards.length === 0) return [];

  const activeToolIds = new Set(
    activeCards
      .map((card) => card.id)
      .filter((value): value is string => value !== null),
  );
  const activeToolNames = new Set(
    activeCards
      .map((card) => card.lookupName)
      .filter((value): value is string => value !== null && value.length > 0),
  );
  const activeToolPriorityById = new Map(
    activeCards
      .map((card) => [card.id, card.priority] as const)
      .filter((item): item is [string, number] => item[0] !== null),
  );
  const activeToolPriorityByName = new Map(
    activeCards
      .map((card) => [card.lookupName, card.priority] as const)
      .filter((item): item is [string, number] => item[0] !== null),
  );

  return enabledTools
    .filter((tool) => {
      if (activeToolIds.has(tool.id)) return true;
      return activeToolNames.has(normalizeToolLookupKey(tool.name));
    })
    .sort((left, right) => {
      const leftPriority =
        activeToolPriorityById.get(left.id) ??
        activeToolPriorityByName.get(normalizeToolLookupKey(left.name)) ??
        Number.MAX_SAFE_INTEGER;
      const rightPriority =
        activeToolPriorityById.get(right.id) ??
        activeToolPriorityByName.get(normalizeToolLookupKey(right.name)) ??
        Number.MAX_SAFE_INTEGER;
      return leftPriority - rightPriority;
    });
}

function roundCreditAmount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const rounded = Math.round(value * 100) / 100;
  if (Math.abs(rounded % 1) < 0.001) return Math.round(rounded);
  return rounded;
}

function splitResponseIntoPreviewBlocks(content: string): string[] {
  const normalized = content
    .replace(/\r\n/g, "\n")
    .replace(/(?:^|\n)\s*###\s*(?=\n|$)/g, "\n\n")
    .replace(/\s+###\s+/g, "\n\n")
    .trim();
  if (!normalized) return [];

  let blocks = normalized
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (blocks.length <= 1) {
    const sentenceChunks = normalized
      .split(/(?<=[.!?])\s+/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (sentenceChunks.length > 1) {
      const chunked: string[] = [];
      let currentChunk = "";

      for (const sentence of sentenceChunks) {
        const candidate = currentChunk
          ? `${currentChunk} ${sentence}`
          : sentence;
        if (candidate.length > 220 && currentChunk) {
          chunked.push(currentChunk);
          currentChunk = sentence;
        } else {
          currentChunk = candidate;
        }
      }

      if (currentChunk) chunked.push(currentChunk);
      blocks = chunked;
    }
  }

  return blocks.slice(0, 8);
}

function stripInlineImageTokensFromText(content: string): string {
  const source = String(content || "");
  if (!source.trim()) return "";

  let normalized = source
    // Remove markdown image token: ![alt](url)
    .replace(/!\[[^\]]*\]\s*\((https?:\/\/[^\s)]+)\)/gi, "")
    // Remove bare image URL token (kept as image timeline event instead)
    .replace(
      /https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|gif|webp|bmp|svg)(?:\?[^\s"'<>]*)?/gi,
      "",
    );

  normalized = normalized
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]*\n[ \t]*\n+/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

  return normalized;
}

function normalizeHttpUrl(value: string): string | null {
  let trimmed = String(value || "").trim();
  if (trimmed) {
    // Strip common trailing punctuation from markdown/plain text URL parsing.
    while (trimmed.length > 0) {
      const last = trimmed[trimmed.length - 1];
      if (/[.,!?;]$/.test(last)) {
        trimmed = trimmed.slice(0, -1);
        continue;
      }

      if (last === ")" || last === "]" || last === "}") {
        const openParenCount = (trimmed.match(/\(/g) || []).length;
        const closeParenCount = (trimmed.match(/\)/g) || []).length;
        const hasUnbalancedClosingParen =
          last === ")" && closeParenCount > openParenCount;
        if (hasUnbalancedClosingParen || last === "]" || last === "}") {
          trimmed = trimmed.slice(0, -1);
          continue;
        }
      }

      break;
    }
  }
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function isLikelyImageUrl(value: string): boolean {
  if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(value)) {
    return true;
  }

  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    const looksLikeFileAsset = pathname.length > 1 && !pathname.endsWith("/");
    const hasBlockedExtension =
      /\.(pdf|txt|json|csv|docx?|xlsx?|zip|rar|7z)(\?|#|$)/i.test(pathname);
    if (
      looksLikeFileAsset &&
      !hasBlockedExtension &&
      (hostname === "files.cekat.ai" || hostname.endsWith(".cekat.ai"))
    ) {
      return true;
    }
  } catch {
    // Ignore malformed URLs.
  }

  return false;
}

function extractImageUrlsFromText(value: string): string[] {
  if (!value) return [];
  const matches = value.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  const normalized = matches
    .map((url) => normalizeHttpUrl(url))
    .filter((url): url is string => url !== null)
    .filter((url) => isLikelyImageUrl(url));
  return Array.from(new Set(normalized));
}

function collectImageUrlsFromUnknown(
  value: unknown,
  parentKey = "",
  depth = 0,
): string[] {
  if (depth > 5 || value === null || value === undefined) return [];

  if (typeof value === "string") {
    const normalized = normalizeHttpUrl(value);
    if (!normalized) return [];
    const shouldUseByKey = /image|photo|banner|thumbnail|poster|picture/i.test(
      parentKey,
    );
    if (isLikelyImageUrl(normalized) || shouldUseByKey) {
      return [normalized];
    }
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      collectImageUrlsFromUnknown(item, parentKey, depth + 1),
    );
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.entries(record).flatMap(([key, child]) =>
      collectImageUrlsFromUnknown(child, key, depth + 1),
    );
  }

  return [];
}

type ImageUrlContext = {
  url: string;
  context: string;
  hint: string;
};

type ImageSelectionSource = {
  id: string;
  title: string | null;
  type: string | null;
  content: string | null;
};

type KnowledgeImageMapping = {
  label: string;
  url: string;
};

type InlineContentSegment =
  | {
      type: "text";
      content: string;
    }
  | {
      type: "image";
      url: string;
    };

function extractImageUrlContextsFromText(value: string): ImageUrlContext[] {
  if (!value) return [];

  const source = String(value || "");
  const collected: ImageUrlContext[] = [];
  const seen = new Set<string>();

  const pushCandidate = (
    urlRaw: string,
    start: number,
    end: number,
    hint = "",
  ) => {
    const normalizedUrl = normalizeHttpUrl(urlRaw);
    if (!normalizedUrl || !isLikelyImageUrl(normalizedUrl)) return;
    if (seen.has(normalizedUrl)) return;

    const lead = Math.max(0, start - 120);
    const tail = Math.min(source.length, end + 120);
    const contextWindow = source.slice(lead, tail).replace(/\s+/g, " ").trim();
    const context = [hint, contextWindow].filter(Boolean).join(" ");
    seen.add(normalizedUrl);
    collected.push({
      url: normalizedUrl,
      context,
      hint,
    });
  };

  const markdownImageRegex = /!\[([^\]]*)\]\s*\((https?:\/\/[^\s)]+)\)/gi;
  let markdownMatch: RegExpExecArray | null = null;
  while ((markdownMatch = markdownImageRegex.exec(source)) !== null) {
    const altText = String(markdownMatch[1] || "").trim();
    const url = String(markdownMatch[2] || "");
    pushCandidate(
      url,
      markdownMatch.index,
      markdownImageRegex.lastIndex,
      altText,
    );
  }

  const plainUrlRegex = /https?:\/\/[^\s"'<>]+/gi;
  let plainMatch: RegExpExecArray | null = null;
  while ((plainMatch = plainUrlRegex.exec(source)) !== null) {
    const url = String(plainMatch[0] || "");
    pushCandidate(url, plainMatch.index, plainUrlRegex.lastIndex);
  }

  return collected;
}

function normalizeInlineContentSegments(
  segments: InlineContentSegment[],
): InlineContentSegment[] {
  const normalized: InlineContentSegment[] = [];
  const seenImageUrls = new Set<string>();

  for (const segment of segments) {
    if (segment.type === "image") {
      const normalizedUrl = normalizeHttpUrl(segment.url);
      if (!normalizedUrl || !isLikelyImageUrl(normalizedUrl)) continue;
      if (seenImageUrls.has(normalizedUrl)) continue;
      seenImageUrls.add(normalizedUrl);
      normalized.push({
        type: "image",
        url: normalizedUrl,
      });
      continue;
    }

    const text = String(segment.content || "")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!text) continue;

    const lastItem = normalized[normalized.length - 1];
    if (lastItem?.type === "text") {
      lastItem.content = `${lastItem.content}\n\n${text}`.trim();
    } else {
      normalized.push({
        type: "text",
        content: text,
      });
    }
  }

  return normalized.slice(0, 30);
}

function splitInlineContentSegments(content: string): InlineContentSegment[] {
  const source = String(content || "");
  if (!source.trim()) return [];

  const imageTokenRegex =
    /!\[[^\]]*\]\s*\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s"'<>]+)/gi;
  const segments: InlineContentSegment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null = null;

  while ((match = imageTokenRegex.exec(source)) !== null) {
    const tokenStart = match.index;
    const tokenEnd = imageTokenRegex.lastIndex;
    const before = source.slice(cursor, tokenStart);
    if (before.trim()) {
      segments.push({
        type: "text",
        content: before,
      });
    }

    const rawUrl = String(match[1] || match[2] || "").trim();
    const normalizedUrl = normalizeHttpUrl(rawUrl);
    if (normalizedUrl && isLikelyImageUrl(normalizedUrl)) {
      segments.push({
        type: "image",
        url: normalizedUrl,
      });
    }

    cursor = tokenEnd;
  }

  const trailing = source.slice(cursor);
  if (trailing.trim()) {
    segments.push({
      type: "text",
      content: trailing,
    });
  }

  return normalizeInlineContentSegments(segments);
}

const IMAGE_SELECTION_STOPWORDS = new Set([
  "halo",
  "saya",
  "kak",
  "kaka",
  "kakak",
  "dengan",
  "untuk",
  "promo",
  "harga",
  "price",
  "minta",
  "tertarik",
  "tolong",
  "ingin",
  "mau",
  "sozo",
  "skin",
  "clinic",
]);

function deriveImageIntentKeywords(messageKeywords: Set<string>): Set<string> {
  const filtered = Array.from(messageKeywords).filter((keyword) => {
    if (!keyword || keyword.length < 3) return false;
    if (IMAGE_SELECTION_STOPWORDS.has(keyword)) return false;
    return true;
  });
  if (filtered.length > 0) return new Set(filtered);
  return new Set(messageKeywords);
}

function scoreImageContextRelevance(
  context: string,
  keywords: Set<string>,
): number {
  if (!context) return 0;
  const normalized = context.toLowerCase();
  let score = scoreByKeywordOverlap(keywords, normalized);

  // Lightweight guardrail to avoid common cross-category mismatch.
  if (
    (keywords.has("ipl") || keywords.has("glow")) &&
    /hair\s*removal|underarm|brazilian/i.test(normalized)
  ) {
    score -= 2;
  }

  return score;
}

function normalizeForKeywordScoring(value: string): string {
  return String(value || "").replace(/[_./-]+/g, " ");
}

function normalizeHtmlToPlainText(value: string): string {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractKnowledgeImageMappings(
  knowledge: KnowledgeContextItem[],
): KnowledgeImageMapping[] {
  const mappings: KnowledgeImageMapping[] = [];
  const seen = new Set<string>();

  const pushMapping = (labelRaw: string, urlRaw: string) => {
    const label = String(labelRaw || "").trim();
    const url = normalizeHttpUrl(urlRaw);
    if (!label || !url || !isLikelyImageUrl(url)) return;
    if (!/[a-z]/i.test(label)) return;
    if (seen.has(url)) return;
    seen.add(url);
    mappings.push({
      label,
      url,
    });
  };

  for (const item of knowledge) {
    const rawContent = String(item.content || "");
    if (!rawContent) continue;
    const normalizedContent = normalizeHtmlToPlainText(rawContent);
    const content = [rawContent, normalizedContent]
      .filter((value) => value.length > 0)
      .join("\n");

    const markdownImageRegex = /!\[([^\]]+)\]\s*\((https?:\/\/[^\s)]+)\)/gi;
    let markdownMatch: RegExpExecArray | null = null;
    while ((markdownMatch = markdownImageRegex.exec(content)) !== null) {
      pushMapping(
        String(markdownMatch[1] || ""),
        String(markdownMatch[2] || ""),
      );
    }

    const lineRegex =
      /(?:^|\n)\s*(?:[#>*-]+\s*)?([^\n:]{2,90}?)(?:\s*[:\-]\s*|\s+)(https?:\/\/[^\s)]+)\s*(?=\n|$)/gi;
    let lineMatch: RegExpExecArray | null = null;
    while ((lineMatch = lineRegex.exec(content)) !== null) {
      const label = String(lineMatch[1] || "")
        .replace(/[#>*-]/g, "")
        .trim();
      const url = String(lineMatch[2] || "").trim();
      pushMapping(label, url);
    }
  }

  return mappings;
}

function scoreGenericPosterPenalty(url: string): number {
  const normalized = String(url || "").toLowerCase();
  let penalty = 0;
  if (
    normalized.includes("flashsale_new_user_area") ||
    normalized.includes("promo_new_customer") ||
    normalized.includes("__apr_")
  ) {
    penalty += 2;
  }
  if (normalized.includes("_general_") || normalized.includes("tiktok_skin")) {
    penalty += 1;
  }
  return penalty;
}

function hasPriceOrPromoCue(value: string): boolean {
  const normalized = String(value || "").toLowerCase();
  if (!normalized) return false;
  return (
    /\b(harga|promo|pricelist|price|flash sale|flash-sale|diskon|voucher)\b/.test(
      normalized,
    ) || /\b(detail harg|detail promo|berikut detail)\b/.test(normalized)
  );
}

function scorePriceImageCue(args: { url: string; context: string }): number {
  const urlText = String(args.url || "").toLowerCase();
  const contextText = String(args.context || "").toLowerCase();
  const combined = `${urlText} ${contextText}`.trim();
  if (!combined) return 0;

  let score = 0;
  if (
    /(harga|promo|flash[\s_-]?sale|pricelist|price\s*list|harga promo|harga normal|new customer|voucher)/i.test(
      combined,
    )
  ) {
    score += 2;
  }
  if (
    /(flash[_-]?sale|flashsale|promo|price|harga|_rb\b|[0-9]{2,4}\s*rb\b|[0-9]{2,4}k\b)/i.test(
      urlText,
    )
  ) {
    score += 2;
  }
  if (
    /(before\s*after|sebelum|sesudah|aftercare|testimoni|hasil treatment|tatto|tato)/i.test(
      combined,
    )
  ) {
    score -= 4;
  }

  return score;
}

function resolveMappedImageUrlByKeywords(args: {
  knowledge: KnowledgeContextItem[];
  keywords: Set<string>;
  preferPriceImage?: boolean;
  requirePriceCue?: boolean;
}): string | null {
  const mappings = extractKnowledgeImageMappings(args.knowledge);
  if (mappings.length === 0 || args.keywords.size === 0) return null;

  const ranked = mappings
    .map((item) => {
      const labelScore = scoreByKeywordOverlap(
        args.keywords,
        normalizeForKeywordScoring(item.label),
      );
      const urlScore = scoreByKeywordOverlap(
        args.keywords,
        normalizeForKeywordScoring(item.url),
      );
      const priceCue = args.preferPriceImage
        ? scorePriceImageCue({
            url: item.url,
            context: item.label,
          })
        : 0;
      const score =
        labelScore * 4 +
        urlScore * 6 -
        scoreGenericPosterPenalty(item.url) +
        priceCue * 8;
      return {
        url: item.url,
        score,
        labelScore,
        urlScore,
        priceCue,
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.priceCue !== left.priceCue)
        return right.priceCue - left.priceCue;
      if (right.score !== left.score) return right.score - left.score;
      if (right.urlScore !== left.urlScore)
        return right.urlScore - left.urlScore;
      return right.labelScore - left.labelScore;
    });

  if (args.preferPriceImage) {
    const priceRanked = ranked.filter((item) => item.priceCue > 0);
    if (priceRanked.length > 0) return priceRanked[0]?.url || null;
    if (args.requirePriceCue) return null;
  }

  return ranked[0]?.url || null;
}

function extractImageCandidates(args: {
  resolvedContent: string;
  selectedKnowledge: KnowledgeContextItem[];
  toolRuns: ToolExecutionResult[];
  messageKeywords: Set<string>;
  preferPriceImage?: boolean;
  requirePriceCue?: boolean;
  maxCandidates?: number;
}): string[] {
  const intentKeywords = deriveImageIntentKeywords(args.messageKeywords);
  // If model provides inline markdown image(s), pick the most relevant one(s) first
  // using surrounding context/alt-text (for example "Harga IPL Glow").
  const inlineResponseContexts = extractImageUrlContextsFromText(
    args.resolvedContent,
  );
  if (inlineResponseContexts.length > 0) {
    const scoredInline = inlineResponseContexts.map((item, index) => {
      const priceCue = args.preferPriceImage
        ? scorePriceImageCue({
            url: item.url,
            context: `${item.hint} ${item.context}`,
          })
        : 0;
      return {
        url: item.url,
        relevance:
          scoreImageContextRelevance(item.hint, intentKeywords) * 5 +
          scoreImageContextRelevance(item.context, intentKeywords) +
          priceCue * 10,
        priceCue,
        index,
      };
    });
    const hasPositive = scoredInline.some((item) => item.relevance > 0);
    const prioritized = hasPositive
      ? scoredInline
          .filter((item) => item.relevance > 0)
          .sort((left, right) => {
            if (right.relevance !== left.relevance) {
              return right.relevance - left.relevance;
            }
            return left.index - right.index;
          })
      : scoredInline;
    if (args.preferPriceImage) {
      const pricedOnly = prioritized.filter((item) => item.priceCue > 0);
      if (pricedOnly.length > 0) {
        return pricedOnly.map((item) => item.url).slice(0, 3);
      }
      if (args.requirePriceCue) return [];
    }
    return prioritized.map((item) => item.url).slice(0, 3);
  }

  const scoredByUrl = new Map<
    string,
    {
      url: string;
      score: number;
      priceCue: number;
      order: number;
    }
  >();
  let order = 0;

  const registerCandidates = (
    contexts: ImageUrlContext[],
    baseScore: number,
    requireIntentMatch: boolean,
  ) => {
    for (const contextItem of contexts) {
      const relevance = scoreImageContextRelevance(
        contextItem.context,
        intentKeywords,
      );
      const urlKeywordScore = scoreByKeywordOverlap(
        intentKeywords,
        contextItem.url,
      );
      if (
        requireIntentMatch &&
        intentKeywords.size > 0 &&
        relevance <= 0 &&
        urlKeywordScore <= 0
      ) {
        continue;
      }

      const priceCue = args.preferPriceImage
        ? scorePriceImageCue({
            url: contextItem.url,
            context: `${contextItem.hint} ${contextItem.context}`,
          })
        : 0;
      const score =
        baseScore + relevance * 12 + urlKeywordScore * 16 + priceCue * 18;
      const existing = scoredByUrl.get(contextItem.url);
      if (
        !existing ||
        score > existing.score ||
        (score === existing.score && priceCue > existing.priceCue)
      ) {
        scoredByUrl.set(contextItem.url, {
          url: contextItem.url,
          score,
          priceCue,
          order,
        });
      }
      order += 1;
    }
  };

  for (const item of args.selectedKnowledge) {
    const contexts = extractImageUrlContextsFromText(
      `${item.title || ""}\n${item.content || ""}`,
    );
    registerCandidates(
      contexts,
      Math.max(0, Number(item.score || 0)) * 5 + 2,
      true,
    );
  }

  for (const toolRun of args.toolRuns) {
    if (!toolRun.responsePreview) continue;
    const textContexts = extractImageUrlContextsFromText(
      toolRun.responsePreview,
    );
    registerCandidates(textContexts, toolRun.ok ? 8 : 1, true);

    try {
      const parsed = JSON.parse(toolRun.responsePreview);
      const parsedUrls = collectImageUrlsFromUnknown(parsed).map((url) => ({
        url,
        context: String(toolRun.responsePreview || ""),
        hint: "",
      }));
      registerCandidates(parsedUrls, toolRun.ok ? 6 : 1, true);
    } catch {
      // Ignore non-JSON payloads.
    }
  }

  const ranked = Array.from(scoredByUrl.values()).sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.order - right.order;
  });
  const maxCandidates = clampNumber(args.maxCandidates ?? 3, 3, 1, 500);
  if (args.preferPriceImage) {
    const pricedOnly = ranked.filter((item) => item.priceCue > 0);
    if (pricedOnly.length > 0) {
      return pricedOnly.map((item) => item.url).slice(0, maxCandidates);
    }
    if (args.requirePriceCue) return [];
  }
  return ranked.map((item) => item.url).slice(0, maxCandidates);
}

function resolveInlineImageUrlForSection(args: {
  currentUrl: string;
  sectionText: string;
  messageKeywords: Set<string>;
  selectedKnowledge: KnowledgeContextItem[];
  toolRuns: ToolExecutionResult[];
  usedUrls?: Set<string>;
  preferPriceImage?: boolean;
  requirePriceCue?: boolean;
}): string {
  const baseKeywords = deriveImageIntentKeywords(args.messageKeywords);
  const sectionKeywords = deriveImageIntentKeywords(tokenize(args.sectionText));
  const mergedKeywords = new Set<string>([
    ...Array.from(baseKeywords),
    ...Array.from(sectionKeywords),
  ]);
  const effectiveKeywords =
    mergedKeywords.size > 0 ? mergedKeywords : baseKeywords;
  const rankWithHints = (url: string): number =>
    scoreByKeywordOverlap(effectiveKeywords, normalizeForKeywordScoring(url)) +
    (args.preferPriceImage
      ? scorePriceImageCue({
          url,
          context: args.sectionText,
        }) * 6
      : 0);
  const currentScore = rankWithHints(args.currentUrl);
  const currentPriceCue = args.preferPriceImage
    ? scorePriceImageCue({
        url: args.currentUrl,
        context: args.sectionText,
      })
    : 0;

  const mappedUrl = resolveMappedImageUrlByKeywords({
    knowledge: args.selectedKnowledge,
    keywords: effectiveKeywords,
    preferPriceImage: args.preferPriceImage,
    requirePriceCue: args.requirePriceCue,
  });
  if (mappedUrl && mappedUrl !== args.currentUrl) {
    const mappedScore = rankWithHints(mappedUrl);
    const mappedPriceCue = args.preferPriceImage
      ? scorePriceImageCue({
          url: mappedUrl,
          context: args.sectionText,
        })
      : 0;
    if (mappedScore > currentScore || mappedPriceCue > currentPriceCue) {
      if (!args.usedUrls || !args.usedUrls.has(mappedUrl)) return mappedUrl;
    }
  }

  const alternatives = extractImageCandidates({
    resolvedContent: "",
    selectedKnowledge: args.selectedKnowledge,
    toolRuns: args.toolRuns,
    messageKeywords: effectiveKeywords,
    preferPriceImage: args.preferPriceImage,
    requirePriceCue: args.requirePriceCue,
  });

  if (alternatives.length === 0) return args.currentUrl;
  const usedUrls = args.usedUrls || new Set<string>();
  const rankCandidate = (url: string) => rankWithHints(url);
  const rankedAlternatives = alternatives
    .filter((url) => url !== args.currentUrl)
    .map((url) => ({
      url,
      score: rankCandidate(url),
      priceCue: args.preferPriceImage
        ? scorePriceImageCue({
            url,
            context: args.sectionText,
          })
        : 0,
      isUsed: usedUrls.has(url),
    }))
    .sort((left, right) => {
      if (left.isUsed !== right.isUsed) return left.isUsed ? 1 : -1;
      if (right.score !== left.score) return right.score - left.score;
      return 0;
    });
  const candidate = rankedAlternatives[0]?.url || null;
  if (!candidate) return args.currentUrl;

  const candidateScore = rankCandidate(candidate);
  const candidatePriceCue = args.preferPriceImage
    ? scorePriceImageCue({
        url: candidate,
        context: args.sectionText,
      })
    : 0;
  const shouldReplace =
    (currentScore <= 0 && candidateScore > 0) ||
    candidateScore > currentScore + 1 ||
    candidatePriceCue > currentPriceCue;

  return shouldReplace ? candidate : args.currentUrl;
}

function normalizeInlineImageTargetsForResponse(args: {
  content: string;
  message: string;
  history: NormalizedHistoryMessage[];
  selectedKnowledge: KnowledgeContextItem[];
  toolRuns: ToolExecutionResult[];
}): string {
  const source = String(args.content || "").trim();
  if (!source) return "";

  const segments = splitInlineContentSegments(source);
  if (!segments.some((segment) => segment.type === "image")) {
    return source;
  }

  const normalizedMessage = String(args.message || "")
    .trim()
    .toLowerCase();
  const preferPriceImage =
    hasPriceOrPromoCue(normalizedMessage) ||
    hasPriceOrPromoCue(source) ||
    isPriceConfirmationIntent(normalizedMessage);
  if (!preferPriceImage) return source;

  const inferredTreatment =
    inferTreatmentFromMessage(args.message) ||
    inferTreatmentFromMessage(source) ||
    inferRecentTreatmentFromHistory(args.history);
  const messageKeywords = tokenize(
    [
      args.message,
      inferredTreatment || "",
      stripInlineImageTokensFromText(source),
    ]
      .filter(Boolean)
      .join(" "),
  );
  const usedUrls = new Set<string>();
  const knownImageUrls = new Set(
    extractImageCandidates({
      resolvedContent: "",
      selectedKnowledge: args.selectedKnowledge,
      toolRuns: args.toolRuns,
      messageKeywords,
      preferPriceImage: false,
      maxCandidates: 400,
    }),
  );
  const normalizedSegments: InlineContentSegment[] = [];
  let activeSectionText = stripInlineImageTokensFromText(source);

  for (const segment of segments) {
    if (segment.type === "text") {
      normalizedSegments.push(segment);
      activeSectionText = segment.content;
      continue;
    }

    const sectionText =
      activeSectionText || stripInlineImageTokensFromText(source);
    let resolvedUrl = segment.url;
    const isKnownUrl = knownImageUrls.has(segment.url);
    const currentPriceCue = scorePriceImageCue({
      url: resolvedUrl,
      context: "",
    });
    if (!isKnownUrl || currentPriceCue <= 0) {
      resolvedUrl = resolveInlineImageUrlForSection({
        currentUrl: segment.url,
        sectionText,
        messageKeywords,
        selectedKnowledge: args.selectedKnowledge,
        toolRuns: args.toolRuns,
        usedUrls,
        preferPriceImage: true,
        requirePriceCue: true,
      });
    }

    if (!knownImageUrls.has(resolvedUrl)) {
      continue;
    }

    const resolvedPriceCue = scorePriceImageCue({
      url: resolvedUrl,
      context: resolvedUrl === segment.url ? "" : sectionText,
    });
    if (resolvedPriceCue <= 0 || usedUrls.has(resolvedUrl)) {
      continue;
    }

    usedUrls.add(resolvedUrl);
    normalizedSegments.push({
      type: "image",
      url: resolvedUrl,
    });
  }

  const rebuilt = normalizeInlineContentSegments(normalizedSegments);
  if (rebuilt.length === 0) {
    return stripInlineImageTokensFromText(source);
  }

  return rebuilt
    .map((segment) => (segment.type === "text" ? segment.content : segment.url))
    .join("\n\n")
    .trim();
}

function buildImageSelectionKnowledgePool(args: {
  knowledgeSources: ImageSelectionSource[];
  messageKeywords: Set<string>;
  limit: number;
}): KnowledgeContextItem[] {
  const normalizedLimit = clampNumber(args.limit, 80, 10, 240);
  const candidates = args.knowledgeSources.map<KnowledgeContextItem | null>(
    (source) => {
      const rawContent = String(source.content || "");
      const plainContent = normalizeHtmlToPlainText(rawContent);
      const baseText = `${source.title || ""}\n${plainContent}`.trim();
      if (!baseText) return null;

      const imageContexts = extractImageUrlContextsFromText(rawContent);
      if (imageContexts.length === 0) return null;

      const keywordScore = scoreByKeywordOverlap(
        args.messageKeywords,
        baseText,
      );
      const contextRelevance = imageContexts.reduce((max, item) => {
        return Math.max(
          max,
          scoreImageContextRelevance(item.context, args.messageKeywords),
        );
      }, 0);

      return {
        type: "source" as const,
        id: source.id,
        title: source.title || source.type || "Knowledge Source",
        // Keep raw HTML/text payload for robust mapping (labels + URLs),
        // while still bounding payload size.
        content: rawContent.slice(0, 40_000),
        score: keywordScore * 4 + contextRelevance * 3 + imageContexts.length,
        keywordScore,
        vectorScore: 0,
      };
    },
  );
  const pooled = candidates
    .filter((item): item is KnowledgeContextItem => item !== null)
    .sort((left, right) => right.score - left.score);

  return pooled.slice(0, normalizedLimit);
}

function extractLabelFromCondition(value: string | null): string | null {
  const source = toNullableString(value);
  if (!source) return null;

  const quoted =
    source.match(/["“']([^"”']{2,64})["”']/)?.[1] ||
    source.match(/\blabel\s*[:=]\s*([a-z0-9 _-]{2,64})/i)?.[1];
  if (!quoted) return null;

  return quoted.trim();
}

type ConfiguredLabelCandidate = {
  id: string;
  title: string;
};

type DynamicLabelKind =
  | "ads"
  | "potential_booking"
  | "location"
  | "schedule"
  | "treatment_concerns"
  | "price_promo"
  | "existing_customer"
  | "unknown";

function normalizeRuleText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractQuotedPhrases(value: string): string[] {
  const source = String(value || "");
  if (!source.trim()) return [];
  const phrases: string[] = [];
  const regex = /["“'`](.{2,120}?)["”'`]/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(source)) !== null) {
    const phrase = String(match[1] || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!phrase) continue;
    phrases.push(phrase);
  }
  return Array.from(new Set(phrases));
}

function isFirstUserTurn(history: NormalizedHistoryMessage[]): boolean {
  return !history.some((item) => item.role === "user");
}

function detectFirstMessageAdsExclusiveRule(args: {
  labelCondition: string | null;
  message: string;
  isFirstUserMessage: boolean;
  hasAdsLabel: boolean;
}): boolean {
  if (!args.isFirstUserMessage || !args.hasAdsLabel) return false;
  const normalizedMessage = normalizeRuleText(args.message);
  if (!normalizedMessage) return false;

  const source = String(args.labelCondition || "");
  const normalizedSource = normalizeRuleText(source);
  const defaultTrigger = /halo\s*sozo.*tertarik\s*promo/i.test(
    normalizedMessage,
  );
  if (!source.trim()) return defaultTrigger;

  const hasFirstMessageRule =
    normalizedSource.includes("first message") &&
    normalizedSource.includes("ads") &&
    (normalizedSource.includes("hanya") || normalizedSource.includes("only"));
  if (!hasFirstMessageRule) return defaultTrigger;

  const triggerPhrases = extractQuotedPhrases(source)
    .map((item) => normalizeRuleText(item))
    .filter((item) => item.includes("halo sozo") && item.includes("promo"));

  if (triggerPhrases.length === 0) return defaultTrigger;
  return triggerPhrases.some((item) => normalizedMessage.includes(item));
}

function classifyDynamicLabelKind(title: string): DynamicLabelKind {
  const normalized = normalizeRuleText(title);
  if (!normalized) return "unknown";
  if (normalized.includes("existing")) return "existing_customer";
  if (normalized.includes("potential") && normalized.includes("booking")) {
    return "potential_booking";
  }
  if (normalized.includes("ads")) return "ads";
  if (normalized.includes("location") || normalized.includes("lokasi"))
    return "location";
  if (normalized.includes("schedule") || normalized.includes("jadwal"))
    return "schedule";
  if (
    normalized.includes("treatment") ||
    normalized.includes("concern") ||
    normalized.includes("keluhan")
  ) {
    return "treatment_concerns";
  }
  if (
    normalized.includes("price") ||
    normalized.includes("promo") ||
    normalized.includes("harga")
  ) {
    return "price_promo";
  }
  return "unknown";
}

function resolveDynamicAppliedLabel(args: {
  message: string;
  history: NormalizedHistoryMessage[];
  labelCondition: string | null;
  configuredLabels: ConfiguredLabelCandidate[];
}): { id: string | null; title: string | null } {
  if (args.configuredLabels.length === 0) {
    return { id: null, title: null };
  }
  const normalizedMessage = normalizeRuleText(args.message);
  if (!normalizedMessage) {
    return { id: null, title: null };
  }

  const isFirstMessage = isFirstUserTurn(args.history);
  const adsLabel = args.configuredLabels.find(
    (item) => classifyDynamicLabelKind(item.title) === "ads",
  );
  if (
    adsLabel &&
    detectFirstMessageAdsExclusiveRule({
      labelCondition: args.labelCondition,
      message: args.message,
      isFirstUserMessage: isFirstMessage,
      hasAdsLabel: true,
    })
  ) {
    return { id: adsLabel.id, title: adsLabel.title };
  }

  const hasConcernHint =
    /\b(concern|keluhan|jerawat|bekas|sensitif|kusam|berminyak|aman ga|sakit ga|durasi|manfaat)\b/i.test(
      normalizedMessage,
    );
  const isPotentialBookingIntent =
    /\b(mau\s*book(?:ing)?|booking|book|konsultasi|iya\s*saya\s*tertarik|saya\s*tertarik|boleh\s*deh\s*coba)\b/i.test(
      normalizedMessage,
    ) && !hasConcernHint;
  const isLocationIntent =
    /\b(lokasi|alamat|cabang|info lokasi|dimana|di mana|terdekat)\b/i.test(
      normalizedMessage,
    ) || Boolean(extractLocationMentionFromText(args.message));
  const isScheduleIntent =
    /\b(jadwal|schedule|slot|reschedule|cancel|batal|weekend|weekday|weekdays|hari ini|besok|lusa|senin|selasa|rabu|kamis|jumat|sabtu|minggu|jam|pukul)\b/i.test(
      normalizedMessage,
    ) || /\b\d{1,2}[:.]\d{2}\b/.test(normalizedMessage);
  const isExistingCustomerIntent =
    /\b(sudah pernah|pernah ke sozo|customer lama|pernah treatment|balik lagi|pernah ke sini)\b/i.test(
      normalizedMessage,
    );
  const isPricePromoIntent =
    /\b(harga|price|pricelist|promo|diskon|deal|ppn|pajak)\b/i.test(
      normalizedMessage,
    ) &&
    !(
      isFirstMessage && /halo\s*sozo.*tertarik\s*promo/i.test(normalizedMessage)
    );
  const isTreatmentConcernIntent =
    /\b(treatment|facial|laser|ipl|meso|hifu|botox|underarm|acne|jerawat|bekas jerawat|sensitif|kusam|mencerahkan|durasi|manfaat|sakit ga|aman ga)\b/i.test(
      normalizedMessage,
    );

  const scored = args.configuredLabels
    .map((label) => {
      const kind = classifyDynamicLabelKind(label.title);
      let score = 0;
      switch (kind) {
        case "ads":
          score = /halo\s*sozo.*tertarik\s*promo/i.test(normalizedMessage)
            ? 200
            : 0;
          break;
        case "existing_customer":
          score = isExistingCustomerIntent ? 180 : 0;
          break;
        case "schedule":
          score = isScheduleIntent ? 160 : 0;
          break;
        case "location":
          score = isLocationIntent ? 150 : 0;
          break;
        case "price_promo":
          score = isPricePromoIntent ? 140 : 0;
          break;
        case "potential_booking":
          score = isPotentialBookingIntent ? 130 : 0;
          break;
        case "treatment_concerns":
          score = isTreatmentConcernIntent ? 120 : 0;
          break;
        default:
          score = 0;
      }

      const titleScore =
        scoreByKeywordOverlap(tokenize(args.message), label.title) * 3;
      return {
        id: label.id,
        title: label.title,
        score: score + titleScore,
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.title.localeCompare(right.title);
    });

  const best = scored[0];
  if (!best || best.score <= 0) return { id: null, title: null };
  return { id: best.id, title: best.title };
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isAgentBehaviorPromptText(value: string): boolean {
  return /(ai agent behaviou?r|core identity|tone of voice|objectives|communication style|discovery questions|safety|guard rail|instruksi agent|panduan handoff|role:\s*ai|personality:|strict rules:)/i.test(
    value,
  );
}

function isAgentBehaviorKnowledgeItem(item: KnowledgeContextItem): boolean {
  return isAgentBehaviorPromptText(`${item.title || ""}\n${item.content || ""}`);
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function capKnowledgeByTotalChars(
  items: KnowledgeContextItem[],
  maxTotalChars: number,
  maxItemChars: number,
): KnowledgeContextItem[] {
  if (items.length === 0) return [];
  const boundedTotal = Math.max(1_000, maxTotalChars);
  const boundedItem = Math.max(200, maxItemChars);
  const result: KnowledgeContextItem[] = [];
  let totalChars = 0;

  for (const item of items) {
    const boundedContent = truncateText(
      String(item.content || ""),
      boundedItem,
    );
    const estimatedCost = item.title.length + boundedContent.length + 48;
    if (result.length > 0 && totalChars + estimatedCost > boundedTotal) break;
    result.push({
      ...item,
      content: boundedContent,
    });
    totalChars += estimatedCost;
  }

  return result;
}

function buildKnowledgeCoverageContext(
  items: KnowledgeContextItem[],
  maxChars: number,
): string | null {
  if (items.length === 0) return null;
  const lines: string[] = [];
  let usedChars = 0;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const snippet = truncateText(String(item.content || ""), 260);
    const line = `[${index + 1}] (${item.type.toUpperCase()}) ${item.title}\n${snippet}`;
    if (usedChars > 0 && usedChars + line.length + 2 > maxChars) {
      const remaining = items.length - index;
      if (remaining > 0) {
        lines.push(
          `... dan ${remaining} knowledge source lainnya tetap wajib dijadikan acuan.`,
        );
      }
      break;
    }
    lines.push(line);
    usedChars += line.length + 2;
  }

  return lines.join("\n\n").trim() || null;
}

function buildRagCacheKey(
  appId: string,
  chatbotId: string,
  allowAllKnowledge = false,
): string {
  const scope = allowAllKnowledge ? "all" : chatbotId;
  return `${RAG_CACHE_PREFIX}${appId}:${scope}:v1`;
}

function normalizeKnowledgeSourceRecord(value: unknown): {
  id: string;
  title: string | null;
  content: string | null;
  type: string | null;
  updated_at: string | null;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = toNullableString(record.id);
  if (!id) return null;
  const title = toNullableString(record.title);
  const content = toNullableString(record.content);
  const type = toNullableString(record.type);
  const updatedAt = toNullableString(record.updated_at);
  return {
    id,
    title,
    content,
    type,
    updated_at: updatedAt,
  };
}

function normalizeKnowledgeFaqRecord(value: unknown): {
  id: string;
  question: string | null;
  answer: string | null;
  priority: number | null;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = toNullableString(record.id);
  if (!id) return null;
  const priorityRaw = Number(record.priority);
  return {
    id,
    question: toNullableString(record.question),
    answer: toNullableString(record.answer),
    priority: Number.isFinite(priorityRaw) ? priorityRaw : null,
  };
}

async function fetchKnowledgeCatalog(args: {
  appId: string;
  chatbotId: string;
  allowAllKnowledge?: boolean;
}): Promise<{
  knowledgeSources: Array<{
    id: string;
    title: string | null;
    content: string | null;
    type: string | null;
    updated_at: string | null;
  }>;
  faqs: Array<{
    id: string;
    question: string | null;
    answer: string | null;
    priority: number | null;
  }>;
}> {
  const allowAllKnowledge = args.allowAllKnowledge === true;
  const cacheKey = buildRagCacheKey(
    args.appId,
    args.chatbotId,
    allowAllKnowledge,
  );
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as Record<string, unknown>;
      const cachedSources = Array.isArray(parsed.knowledgeSources)
        ? parsed.knowledgeSources
            .map((item) => normalizeKnowledgeSourceRecord(item))
            .filter(
              (
                item,
              ): item is NonNullable<
                ReturnType<typeof normalizeKnowledgeSourceRecord>
              > => item !== null,
            )
        : [];
      const cachedFaqs = Array.isArray(parsed.faqs)
        ? parsed.faqs
            .map((item) => normalizeKnowledgeFaqRecord(item))
            .filter(
              (
                item,
              ): item is NonNullable<
                ReturnType<typeof normalizeKnowledgeFaqRecord>
              > => item !== null,
            )
        : [];
      if (cachedSources.length > 0 || cachedFaqs.length > 0) {
        return {
          knowledgeSources: cachedSources,
          faqs: cachedFaqs,
        };
      }
    }
  } catch (cacheReadError) {
    console.warn("[ChatbotSimulationService] Failed reading RAG cache", {
      appId: args.appId,
      chatbotId: args.chatbotId,
      cacheReadError,
    });
  }

  const [knowledgeSources, faqs] = await Promise.all([
    prisma.knowledge_sources.findMany({
      where: {
        app_id: args.appId,
        ...(allowAllKnowledge ? {} : { chatbot_id: args.chatbotId }),
        is_active: true,
      },
      orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      take: 200,
      select: {
        id: true,
        title: true,
        content: true,
        type: true,
        updated_at: true,
      },
    }),
    prisma.knowledge_faqs.findMany({
      where: {
        app_id: args.appId,
        ...(allowAllKnowledge ? {} : { chatbot_id: args.chatbotId }),
        is_active: true,
      },
      orderBy: [
        { priority: "desc" },
        { updated_at: "desc" },
        { created_at: "desc" },
      ],
      take: 200,
      select: {
        id: true,
        question: true,
        answer: true,
        priority: true,
      },
    }),
  ]);

  const normalizedSources = knowledgeSources.map((item) => ({
    id: item.id,
    title: item.title || null,
    content: item.content || null,
    type: item.type || null,
    updated_at: item.updated_at ? item.updated_at.toISOString() : null,
  }));
  const normalizedFaqs = faqs.map((item) => ({
    id: item.id,
    question: item.question || null,
    answer: item.answer || null,
    priority: item.priority ?? null,
  }));

  try {
    await redis.set(
      cacheKey,
      JSON.stringify({
        knowledgeSources: normalizedSources,
        faqs: normalizedFaqs,
        cached_at: new Date().toISOString(),
      }),
      "EX",
      RAG_KNOWLEDGE_CACHE_TTL_SECONDS,
    );
  } catch (cacheWriteError) {
    console.warn("[ChatbotSimulationService] Failed writing RAG cache", {
      appId: args.appId,
      chatbotId: args.chatbotId,
      cacheWriteError,
    });
  }

  return {
    knowledgeSources: normalizedSources,
    faqs: normalizedFaqs,
  };
}

async function resolveEmbeddingVector(args: {
  appId: string;
  runtime: ProviderRuntime;
  message: string;
}): Promise<number[] | null> {
  const [settings, embeddingRuntimeProvider] = await Promise.all([
    AIService.getSettings(args.appId).catch(() => null),
    AIService.getRuntimeProviderConfig("embedding").catch(() => null),
  ]);
  const provider =
    toNullableString(embeddingRuntimeProvider?.provider) || args.runtime.provider;
  const baseUrl =
    toNullableString(embeddingRuntimeProvider?.base_url) ||
    toNullableString(settings?.api_endpoint) ||
    args.runtime.baseUrl;
  const apiKey =
    toNullableString(embeddingRuntimeProvider?.api_key) ||
    toNullableString(settings?.api_key) ||
    args.runtime.apiKey;
  const apiVersion =
    toNullableString(embeddingRuntimeProvider?.api_version) ||
    toNullableString(settings?.api_version) ||
    args.runtime.apiVersion ||
    "2024-02-15-preview";
  const deploymentName =
    toNullableString(embeddingRuntimeProvider?.deployment_name) ||
    toNullableString(settings?.deployment_name) ||
    args.runtime.deploymentName;

  if (!baseUrl || !apiKey) return null;
  const embeddingModel =
    toNullableString(process.env.AI_EMBEDDING_MODEL) ||
    "text-embedding-3-small";
  const isAzure =
    (provider || "").toLowerCase() === "azure" ||
    baseUrl.includes(".openai.azure.com");

  try {
    if (isAzure) {
      const deployment = deploymentName || embeddingModel;
      const endpoint = joinUrl(
        baseUrl,
        `openai/deployments/${encodeURIComponent(deployment)}/embeddings?api-version=${encodeURIComponent(apiVersion)}`,
      );
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
        },
        body: JSON.stringify({ input: args.message }),
      });
      if (!response.ok) return null;
      const payload = (await response.json().catch(() => null)) as unknown;
      return extractEmbeddingVector(payload);
    }

    const baseUrlEndsWithVersion = /\/v\d+\/?$/i.test(baseUrl);
    const endpoint = joinUrl(
      baseUrl,
      baseUrlEndsWithVersion ? "/embeddings" : "/v1/embeddings",
    );
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: embeddingModel,
        input: args.message,
      }),
    });
    if (!response.ok) return null;
    const payload = (await response.json().catch(() => null)) as unknown;
    return extractEmbeddingVector(payload);
  } catch {
    return null;
  }
}

function extractEmbeddingVector(payload: unknown): number[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return null;
  const record = payload as Record<string, unknown>;
  const data = Array.isArray(record.data) ? record.data : [];
  if (data.length === 0) return null;
  const first = data[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return null;
  const embeddingRaw = (first as Record<string, unknown>).embedding;
  if (!Array.isArray(embeddingRaw)) return null;
  const embedding = embeddingRaw
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (embedding.length === 0) return null;
  return embedding;
}

function toVectorLiteral(vector: number[]): string {
  const values = vector.map((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "0";
    return Number(numeric.toFixed(8)).toString();
  });
  return `[${values.join(",")}]`;
}

async function resolveVectorScores(args: {
  appId: string;
  chatbotId: string;
  vector: number[];
  allowAllKnowledge?: boolean;
}): Promise<Map<string, number>> {
  if (args.vector.length === 0) return new Map();
  const allowAllKnowledge = args.allowAllKnowledge === true;
  const vectorLiteral = toVectorLiteral(args.vector);
  type ChunkVectorRow = {
    source_id: string | null;
    similarity: number | null;
  };
  type LegacyVectorRow = {
    source_id: string | null;
    faq_id: string | null;
    similarity: number | null;
  };
  const scoreByKnowledge = new Map<string, number>();

  // Canonical retrieval source: knowledge_chunks (vector(1536)).
  if (args.vector.length === 1536) {
    try {
      const rows = (await prisma.$queryRawUnsafe(
        `
					SELECT
						kc.source_id::text AS source_id,
						MAX((1 - (kc.embedding <=> $1::vector))::float8) AS similarity
					FROM knowledge_chunks kc
					JOIN knowledge_sources ks ON ks.id = kc.source_id
					WHERE kc.embedding IS NOT NULL
					  AND kc.app_id = $2::uuid
					  AND ($3::bool OR kc.chatbot_id = $4::uuid)
					  AND COALESCE(ks.is_active, true) = true
					  AND COALESCE(ks.status, 'pending') = 'ready'
					GROUP BY kc.source_id
					ORDER BY similarity DESC
					LIMIT $5
				`,
        vectorLiteral,
        args.appId,
        allowAllKnowledge,
        args.chatbotId,
        RAG_VECTOR_TOP_K,
      )) as ChunkVectorRow[];

      for (const row of rows) {
        const similarity = Number(row.similarity || 0);
        if (!Number.isFinite(similarity)) continue;
        const sourceId = toNullableString(row.source_id);
        if (!sourceId) continue;
        scoreByKnowledge.set(`source:${sourceId}`, similarity);
      }
    } catch {
      // Fallback to legacy embeddings query below.
    }
  }

  // Legacy fallback path for FAQ vectors and backward compatibility.
  try {
    const rows = (await prisma.$queryRawUnsafe(
      `
				SELECT
					e.source_id::text AS source_id,
					e.faq_id::text AS faq_id,
					(1 - (e.embedding <=> $1::vector))::float8 AS similarity
				FROM embeddings e
				LEFT JOIN knowledge_sources ks ON ks.id = e.source_id
				LEFT JOIN knowledge_faqs kf ON kf.id = e.faq_id
				WHERE e.embedding IS NOT NULL
					  AND (
					    (
					      ks.id IS NOT NULL
					      AND ks.app_id = $2::uuid
					      AND ($3::bool OR ks.chatbot_id = $4::uuid)
					      AND COALESCE(ks.is_active, true) = true
					      AND COALESCE(ks.status, 'pending') = 'ready'
					    )
					    OR
					    (
					      kf.id IS NOT NULL
					      AND kf.app_id = $2::uuid
					      AND ($3::bool OR kf.chatbot_id = $4::uuid)
					      AND COALESCE(kf.is_active, true) = true
					    )
					  )
				ORDER BY e.embedding <=> $1::vector
				LIMIT $5
			`,
      vectorLiteral,
      args.appId,
      allowAllKnowledge,
      args.chatbotId,
      RAG_VECTOR_TOP_K,
    )) as LegacyVectorRow[];

    for (const row of rows) {
      const similarity = Number(row.similarity || 0);
      if (!Number.isFinite(similarity)) continue;
      const sourceId = toNullableString(row.source_id);
      const faqId = toNullableString(row.faq_id);
      const key = sourceId
        ? `source:${sourceId}`
        : faqId
          ? `faq:${faqId}`
          : null;
      if (!key) continue;
      const previous = scoreByKnowledge.get(key) || 0;
      if (similarity > previous) {
        scoreByKnowledge.set(key, similarity);
      }
    }
  } catch {
    // Keep partial scores if any.
  }

  return scoreByKnowledge;
}

function resolveRetrievalIntent(args: {
  message: string;
  history: NormalizedHistoryMessage[];
  strictFollowupMode?: boolean;
}): RetrievalIntent {
  const normalizedMessage = String(args.message || "")
    .trim()
    .toLowerCase();
  if (!normalizedMessage) return "general";

  if (
    !args.strictFollowupMode &&
    inferLocationIntent({ message: normalizedMessage })
  ) {
    return "location";
  }
  if (
    isPriceConfirmationIntent(normalizedMessage) ||
    hasPriceOrPromoCue(normalizedMessage)
  ) {
    return "price_promo";
  }
  if (isServiceCatalogIntent(normalizedMessage)) return "service_catalog";
  if (
    /\b(treatment|facial|laser|ipl|meso|hifu|botox|acne|jerawat|rambut|hair|prp|glow|brightening)\b/i.test(
      normalizedMessage,
    )
  ) {
    return "treatment";
  }

  const hasNominal = /\brp\.?\s*\d[\d.,]*|\b\d{2,5}\s*(rb|ribu|k)\b/i.test(
    normalizedMessage,
  );
  if (hasNominal && inferRecentTreatmentFromHistory(args.history)) {
    return "price_promo";
  }

  return "general";
}

function resolveRetrievalProfile(intent: RetrievalIntent): RetrievalProfile {
  const base: RetrievalProfile = {
    intent,
    keywordBoost: RAG_KEYWORD_SCORE_BOOST,
    vectorBoost: RAG_VECTOR_SIMILARITY_BOOST,
    minTotalScore: RAG_MIN_TOTAL_SCORE,
    minKeywordOverlap: RAG_MIN_KEYWORD_OVERLAP,
    minVectorSimilarity: RAG_MIN_VECTOR_SIMILARITY,
    liveContextItemCap: RAG_LIVE_CONTEXT_ITEM_CAP,
    liveCharBudget: RAG_LIVE_CHAR_BUDGET,
    liveMaxItemChars: RAG_LIVE_MAX_ITEM_CHARS,
  };
  if (!RAG_ACCURACY_FIRST_ENABLED) return base;

  switch (intent) {
    case "price_promo":
      return {
        ...base,
        keywordBoost: Math.max(base.keywordBoost, 5),
        vectorBoost: Math.max(base.vectorBoost, 8),
        minTotalScore: Math.max(base.minTotalScore, 6),
        minKeywordOverlap: Math.max(base.minKeywordOverlap, 2),
        minVectorSimilarity: Math.max(base.minVectorSimilarity, 0.45),
        liveContextItemCap: Math.min(base.liveContextItemCap, 10),
        liveCharBudget: Math.min(base.liveCharBudget, 12_000),
        liveMaxItemChars: Math.min(base.liveMaxItemChars, 1_400),
      };
    case "treatment":
      return {
        ...base,
        keywordBoost: Math.max(base.keywordBoost, 4),
        vectorBoost: Math.max(base.vectorBoost, 8),
        minTotalScore: Math.max(base.minTotalScore, 4),
        minKeywordOverlap: Math.max(base.minKeywordOverlap, 1),
        minVectorSimilarity: Math.max(base.minVectorSimilarity, 0.35),
        liveContextItemCap: Math.max(base.liveContextItemCap, 14),
        liveCharBudget: Math.max(base.liveCharBudget, 18_000),
        liveMaxItemChars: Math.max(base.liveMaxItemChars, 1_800),
      };
    case "service_catalog":
      return {
        ...base,
        keywordBoost: Math.max(base.keywordBoost, 4),
        minTotalScore: Math.max(base.minTotalScore, 4),
        liveContextItemCap: Math.max(base.liveContextItemCap, 18),
        liveCharBudget: Math.max(base.liveCharBudget, 22_000),
      };
    case "location":
      return {
        ...base,
        minTotalScore: Math.max(base.minTotalScore, 4),
        liveContextItemCap: Math.min(base.liveContextItemCap, 8),
        liveCharBudget: Math.min(base.liveCharBudget, 9_000),
      };
    case "general":
    default:
      return {
        ...base,
        minTotalScore: Math.max(base.minTotalScore, 4),
        minVectorSimilarity: Math.max(base.minVectorSimilarity, 0.35),
        liveContextItemCap: Math.max(base.liveContextItemCap, 14),
        liveCharBudget: Math.max(base.liveCharBudget, 18_000),
      };
  }
}

function isMetaInstructionKnowledge(content: string): boolean {
  return /(core identity|tone of voice|communication style|objectives|discovery questions|guard rail|agent transfer|handoff)/i.test(
    content,
  );
}

function prioritizeKnowledgeForAccuracy(args: {
  items: KnowledgeContextItem[];
  intent: RetrievalIntent;
  message: string;
  history: NormalizedHistoryMessage[];
  messageKeywords: Set<string>;
}): KnowledgeContextItem[] {
  if (!RAG_ACCURACY_FIRST_ENABLED || args.items.length <= 1) return args.items;

  const nonMeta = args.items.filter((item) => {
    const merged = `${item.title}\n${item.content}`;
    return !isMetaInstructionKnowledge(merged);
  });
  const workingSet =
    args.intent === "price_promo" && nonMeta.length > 0 ? nonMeta : args.items;
  if (args.intent !== "price_promo") return workingSet;

  const treatmentCandidate =
    inferTreatmentFromMessage(args.message) ||
    inferRecentTreatmentFromHistory(args.history) ||
    "";
  const treatmentTokens = tokenize(treatmentCandidate);
  const hasTreatmentFocus = treatmentTokens.size > 0;
  const strong: KnowledgeContextItem[] = [];
  const fallback: KnowledgeContextItem[] = [];

  for (const item of workingSet) {
    const merged = `${item.title}\n${item.content}`;
    const normalized = merged.toLowerCase();
    const hasPriceCue =
      /\b(harga|promo|price|flash sale|flash-sale|new customer|member|diskon)\b/i.test(
        normalized,
      );
    const hasCatalogCue =
      /https?:\/\/files\.cekat\.ai\/\S+/i.test(merged) ||
      /^#{1,6}\s+.+https?:\/\//im.test(merged);
    const hasDistractorCue =
      /(aftercare|before\s*after|testimoni|hasil treatment)/i.test(normalized);
    const queryOverlap = scoreByKeywordOverlap(args.messageKeywords, merged);
    const treatmentOverlap = hasTreatmentFocus
      ? scoreByKeywordOverlap(treatmentTokens, merged)
      : 0;
    const boostedScore =
      Number(item.score || 0) +
      (hasPriceCue ? 12 : 0) +
      (hasCatalogCue ? 6 : 0) +
      queryOverlap * 2 +
      treatmentOverlap * 8 -
      (!hasPriceCue && hasDistractorCue ? 10 : 0);
    const boostedItem: KnowledgeContextItem = {
      ...item,
      score: boostedScore,
    };

    if (
      hasPriceCue ||
      treatmentOverlap > 0 ||
      (queryOverlap >= 3 && hasCatalogCue)
    ) {
      strong.push(boostedItem);
      continue;
    }
    if (!hasDistractorCue && queryOverlap > 0) {
      fallback.push(boostedItem);
    }
  }

  if (strong.length > 0)
    return strong.sort((left, right) => right.score - left.score);
  if (fallback.length > 0)
    return fallback.sort((left, right) => right.score - left.score);
  return workingSet;
}

function compressKnowledgeWithRTK(args: {
  items: KnowledgeContextItem[];
  contextLimit: number;
  mode: "simulate" | "live";
  liveCharBudget?: number;
  liveMaxItemChars?: number;
}): {
  items: KnowledgeContextItem[];
  summary: RtkSummaryLog;
} {
  const beforeCount = args.items.length;
  const beforeChars = args.items.reduce(
    (sum, item) => sum + item.title.length + item.content.length,
    0,
  );
  const dedupeSet = new Set<string>();
  const deduped: KnowledgeContextItem[] = [];
  let dedupedCount = 0;
  const droppedItems: string[] = [];

  for (const item of args.items) {
    if (!item.content.trim()) {
      droppedItems.push(item.title);
      continue;
    }
    const stableId =
      toNullableString(item.id) ||
      `${item.type}:${normalizeToolLookupKey(item.title)}`;
    const dedupeKey = `${item.type}:${stableId}:${normalizeToolLookupKey(item.title)}:${normalizeToolLookupKey(item.content.slice(0, 120))}`;
    if (dedupeSet.has(dedupeKey)) {
      dedupedCount += 1;
      continue;
    }
    dedupeSet.add(dedupeKey);
    deduped.push(item);
  }

  const grouped: KnowledgeContextItem[] = [];
  const faqItems = deduped.filter((item) => item.type === "faq");
  const sourceItems = deduped.filter((item) => item.type === "source");
  const rounds = Math.max(faqItems.length, sourceItems.length);
  for (let index = 0; index < rounds; index += 1) {
    if (faqItems[index]) grouped.push(faqItems[index]);
    if (sourceItems[index]) grouped.push(sourceItems[index]);
  }

  const charBudget =
    args.mode === "live"
      ? clampNumber(
          args.liveCharBudget ?? RAG_LIVE_CHAR_BUDGET,
          RAG_LIVE_CHAR_BUDGET,
          4_000,
          48_000,
        )
      : Math.max(3_000, args.contextLimit * 1_100);
  const maxItemChars =
    args.mode === "live"
      ? clampNumber(
          args.liveMaxItemChars ?? RAG_LIVE_MAX_ITEM_CHARS,
          RAG_LIVE_MAX_ITEM_CHARS,
          600,
          4_000,
        )
      : 1_500;
  const limited: KnowledgeContextItem[] = [];
  let consumedChars = 0;
  for (const item of grouped) {
    if (limited.length >= args.contextLimit && args.mode !== "live") break;
    const boundedContent = truncateText(item.content, maxItemChars);
    const nextCost = item.title.length + boundedContent.length + 32;
    if (limited.length > 0 && consumedChars + nextCost > charBudget) break;
    limited.push({
      ...item,
      content: boundedContent,
    });
    consumedChars += nextCost;
  }

  const afterChars = limited.reduce(
    (sum, item) => sum + item.title.length + item.content.length,
    0,
  );
  const summary: RtkSummaryLog = {
    before_count: beforeCount,
    after_count: limited.length,
    before_chars: beforeChars,
    after_chars: afterChars,
    deduped_count: dedupedCount,
    dropped_count: Math.max(0, beforeCount - limited.length),
    dropped_items: droppedItems.slice(0, 20),
  };
  return {
    items: limited,
    summary,
  };
}

function filterKnowledgeByRelevance(
  items: KnowledgeContextItem[],
  thresholds?: {
    minTotalScore?: number;
    minKeywordOverlap?: number;
    minVectorSimilarity?: number;
  },
): KnowledgeContextItem[] {
  const minTotalScore = clampNumber(
    thresholds?.minTotalScore ?? RAG_MIN_TOTAL_SCORE,
    RAG_MIN_TOTAL_SCORE,
    0,
    100,
  );
  const minKeywordOverlap = clampNumber(
    thresholds?.minKeywordOverlap ?? RAG_MIN_KEYWORD_OVERLAP,
    RAG_MIN_KEYWORD_OVERLAP,
    0,
    20,
  );
  const minVectorSimilarity = clampNumber(
    thresholds?.minVectorSimilarity ?? RAG_MIN_VECTOR_SIMILARITY,
    RAG_MIN_VECTOR_SIMILARITY,
    0,
    1,
  );
  return items.filter((item) => {
    const totalScore = Number(item.score || 0);
    const keywordScore = Number(item.keywordScore || 0);
    const vectorScore = Number(item.vectorScore || 0);
    return (
      totalScore >= minTotalScore ||
      keywordScore >= minKeywordOverlap ||
      vectorScore >= minVectorSimilarity
    );
  });
}

function serializeKnowledgeReferences(
  items: KnowledgeContextItem[],
): KnowledgeReferenceLog[] {
  return items.slice(0, 12).map((item) => ({
    type: item.type,
    id:
      toNullableString(item.id) ||
      `${item.type}:${normalizeToolLookupKey(item.title) || "knowledge"}`,
    title: item.title,
    score: Number(item.score.toFixed(6)),
    excerpt: truncateText(stripHtml(item.content), 260),
  }));
}

function mapUsageCostFromTokens(totalTokens: number): {
  credits: number;
  usd: number;
  idr: number;
} {
  const normalized = Math.max(0, Math.trunc(totalTokens || 0));
  return {
    credits: normalized,
    usd: normalized,
    idr: normalized,
  };
}

function buildActiveToolsContext(args: {
  activeConfiguredToolNames: string[];
  candidateTools: APIToolRecord[];
  availableTools: APIToolRecord[];
}): string | null {
  const configuredNames = Array.from(
    new Set(
      args.activeConfiguredToolNames
        .map((name) => String(name || "").trim())
        .filter(Boolean),
    ),
  );
  const candidateByName = new Map(
    args.candidateTools.map(
      (tool) => [normalizeToolLookupKey(tool.name), tool] as const,
    ),
  );
  const availableByName = new Map(
    args.availableTools.map(
      (tool) => [normalizeToolLookupKey(tool.name), tool] as const,
    ),
  );

  const prioritizedTools: APIToolRecord[] = [];
  for (const configuredName of configuredNames) {
    const lookup = normalizeToolLookupKey(configuredName);
    const tool = candidateByName.get(lookup) || availableByName.get(lookup);
    if (tool) prioritizedTools.push(tool);
  }
  for (const tool of args.candidateTools) {
    if (prioritizedTools.some((item) => item.id === tool.id)) continue;
    prioritizedTools.push(tool);
  }

  if (prioritizedTools.length === 0 && configuredNames.length === 0)
    return null;

  const lines: string[] = [];
  if (prioritizedTools.length > 0) {
    for (const tool of prioritizedTools.slice(0, 20)) {
      const required =
        Array.isArray(tool.required) && tool.required.length > 0
          ? tool.required.join(", ")
          : "-";
      const description = toNullableString(tool.description) || "-";
      lines.push(
        `- ${tool.name} | method=${tool.method || "POST"} | required=${required}\n  desc: ${truncateText(description, 220)}`,
      );
    }
  }

  if (lines.length === 0 && configuredNames.length > 0) {
    lines.push(
      `- Active tool names from AI Agent setting: ${configuredNames.join(", ")}`,
    );
  }

  return lines.join("\n").trim() || null;
}

function buildEvaluationContext(
  evaluations: Array<{
    id: string;
    type: string | null;
    content: string | null;
    metadata: unknown;
    created_at: Date | null;
  }>,
): string | null {
  if (evaluations.length === 0)
    return "Tidak ada evaluation aktif yang tersimpan.";

  const lines: string[] = [];
  for (const evaluation of evaluations.slice(0, 50)) {
    const metadata = toRecord(evaluation.metadata);
    const score =
      typeof metadata?.score === "number"
        ? String(metadata.score)
        : toNullableString(metadata?.score);
    const feedback = toNullableString(metadata?.feedback);
    const body = toNullableString(evaluation.content);
    const parts = [
      `- [${evaluation.type || "evaluation"}] ${evaluation.id}`,
      score ? `score=${score}` : null,
      feedback ? `feedback=${truncateText(feedback, 120)}` : null,
      body ? `content=${truncateText(body, 220)}` : null,
    ].filter((part): part is string => Boolean(part));
    lines.push(parts.join(" | "));
  }

  if (evaluations.length > 50) {
    lines.push(
      `- ... ${evaluations.length - 50} evaluation lainnya juga tersedia.`,
    );
  }

  return lines.join("\n");
}

function extractRelevantKnowledgeWindow(
  value: string,
  keywords: Set<string>,
  maxChars: number,
  phraseHints: string[] = [],
): string {
  const content = String(value || "").trim();
  if (!content) return "";
  if (content.length <= maxChars) return content;
  if (keywords.size === 0 && phraseHints.length === 0) {
    return truncateText(content, maxChars);
  }

  const normalized = content.toLowerCase();
  let bestIndex = -1;
  let bestKeywordLength = 0;

  for (const phrase of phraseHints) {
    const normalizedPhrase = phrase.toLowerCase().trim();
    if (!normalizedPhrase || normalizedPhrase.length < 5) continue;
    const idx = normalized.indexOf(normalizedPhrase);
    if (idx < 0) continue;

    if (
      bestIndex < 0 ||
      normalizedPhrase.length > bestKeywordLength ||
      (normalizedPhrase.length === bestKeywordLength && idx < bestIndex)
    ) {
      bestIndex = idx;
      bestKeywordLength = normalizedPhrase.length;
    }
  }

  for (const keyword of keywords) {
    if (!keyword || keyword.length < 3) continue;
    const idx = normalized.indexOf(keyword.toLowerCase());
    if (idx < 0) continue;

    if (
      bestIndex < 0 ||
      keyword.length > bestKeywordLength ||
      (keyword.length === bestKeywordLength && idx < bestIndex)
    ) {
      bestIndex = idx;
      bestKeywordLength = keyword.length;
    }
  }

  if (bestIndex < 0) return truncateText(content, maxChars);

  const leadContext = Math.floor(maxChars * 0.35);
  let start = Math.max(0, bestIndex - leadContext);
  let end = Math.min(content.length, start + maxChars);
  if (end - start < maxChars) {
    start = Math.max(0, end - maxChars);
  }

  const window = content.slice(start, end).trim();
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  return `${prefix}${window}${suffix}`;
}

function normalizeHistory(
  history: unknown,
  maxItems: number,
): NormalizedHistoryMessage[] {
  if (!Array.isArray(history)) return [];

  const normalized = history
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const rawRole = String(record.role || "")
        .trim()
        .toLowerCase();
      const role: "user" | "assistant" =
        rawRole === "assistant" || rawRole === "bot" || rawRole === "ai"
          ? "assistant"
          : "user";
      const content = toNullableString(record.content);
      if (!content) return null;
      return {
        role,
        content,
      };
    })
    .filter((item): item is NormalizedHistoryMessage => item !== null);

  if (normalized.length <= maxItems) return normalized;
  return normalized.slice(-maxItems);
}

function tokenize(value: string): Set<string> {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

  return new Set(normalized);
}

const RETRIEVAL_PHRASE_STOPWORDS = new Set([
  "dan",
  "atau",
  "yang",
  "itu",
  "ini",
  "untuk",
  "kak",
  "nya",
  "ya",
  "the",
  "for",
  "with",
  "that",
  "this",
]);

const PRICE_CONFIRMATION_KEYWORDS = [
  "yakin",
  "bener",
  "benar",
  "betul",
  "serius",
  "fix",
  "pasti",
  "cek lagi",
  "cek kembali",
  "konfirmasi",
  "beneran",
];

const TREATMENT_CONTEXT_STOPWORDS = new Set([
  "berapa",
  "apa",
  "ada",
  "mau",
  "tau",
  "tahu",
  "tolong",
  "harga",
  "harganya",
  "biaya",
  "promo",
  "treatment",
  "untuk",
  "saat",
  "ini",
  "adalah",
  "ya",
  "kak",
  "detail",
  "berikut",
  "itu",
  "yang",
  "kamu",
  "aku",
  "saya",
  "mohon",
  "maaf",
]);

function extractPhraseHints(value: string): string[] {
  const tokens = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !RETRIEVAL_PHRASE_STOPWORDS.has(token));

  if (tokens.length < 2) return [];

  const phrases = new Set<string>();
  const maxPhraseLength = Math.min(4, tokens.length);
  for (let length = maxPhraseLength; length >= 2; length--) {
    for (let index = 0; index <= tokens.length - length; index++) {
      const slice = tokens.slice(index, index + length);
      if (!slice.some((token) => token.length >= 4)) continue;
      phrases.add(slice.join(" "));
    }
  }

  return [...phrases];
}

function isPriceConfirmationIntent(message: string): boolean {
  const normalized = String(message || "").toLowerCase();
  const hasPriceKeyword = /\bharga|biaya|price\b/.test(normalized);
  const hasConfirmKeyword = PRICE_CONFIRMATION_KEYWORDS.some((keyword) =>
    normalized.includes(keyword),
  );
  const hasNominal = /\brp\.?\s*\d[\d.,]*|\b\d{2,5}\s*(rb|ribu|k)\b/.test(
    normalized,
  );

  return (
    (hasPriceKeyword && (hasConfirmKeyword || hasNominal)) ||
    (hasConfirmKeyword && hasNominal)
  );
}

function normalizeTreatmentContextCandidate(value: string): string | null {
  const normalized = String(value || "")
    .replace(/^\s*(untuk|harga untuk)\s+/i, "")
    .replace(/[“”"']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b(saat ini|adalah|ya kak|ya|kak|nih|dong)\b.*$/i, "")
    .trim();

  if (!normalized) return null;

  const terms = normalized
    .split(/\s+/)
    .filter((term) => term.length >= 3)
    .filter((term) => !TREATMENT_CONTEXT_STOPWORDS.has(term.toLowerCase()))
    .slice(0, 6);

  if (terms.length === 0) return null;
  if (terms.length === 1 && terms[0].length < 5) return null;
  return terms.join(" ");
}

function inferRecentTreatmentFromHistory(
  history: NormalizedHistoryMessage[],
): string | null {
  const patterns = [
    /harga untuk\s+([a-z0-9][a-z0-9\s/+&-]{2,90}?)(?:\s+saat ini|\s+adalah|[,.!?]|$)/i,
    /untuk\s+([a-z0-9][a-z0-9\s/+&-]{2,90}?),\s*saat ini harganya/i,
    /(acne laser facial|botox|underarm brightening|ipl acne|meso acne|acne peel|rejuran scar)/i,
  ];

  for (const item of [...history].reverse()) {
    const content = String(item.content || "").trim();
    if (!content) continue;

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (!match) continue;
      const rawCandidate = match[1] || match[0];
      const normalizedCandidate =
        normalizeTreatmentContextCandidate(rawCandidate);
      if (normalizedCandidate) return normalizedCandidate;
    }
  }

  return null;
}

function inferTreatmentFromMessage(message: string): string | null {
  const normalizedMessage = String(message || "").trim();
  if (!normalizedMessage) return null;

  const patterns = [
    /untuk\s+([a-z0-9][a-z0-9\s/+&-]{2,90}?),\s*saat ini harganya/i,
    /(?:harga|biaya|price)\s+(?:untuk\s+)?([a-z0-9][a-z0-9\s/+&-]{2,90}?)(?:\s+(?:berapa|berapa ya|berapa itu)|[,.!?]|$)/i,
    /(acne laser facial|botox|underarm brightening|ipl acne|meso acne|acne peel|rejuran scar)/i,
    /^([a-z0-9][a-z0-9\s/+&-]{2,90}?)\s+(?:biaya|harga|price)\b/i,
  ];

  for (const pattern of patterns) {
    const match = normalizedMessage.match(pattern);
    if (!match) continue;
    const rawCandidate = match[1] || match[0];
    const candidate = normalizeTreatmentContextCandidate(rawCandidate);
    if (candidate) return candidate;
  }

  return null;
}

function buildImageIntentKeywords(args: {
  messageKeywords: Set<string>;
  message: string;
  resolvedContent: string;
  history: NormalizedHistoryMessage[];
}): Set<string> {
  const merged = new Set<string>(args.messageKeywords);
  const inferredTreatmentCandidates = [
    inferTreatmentFromMessage(args.message),
    inferTreatmentFromMessage(args.resolvedContent),
    inferRecentTreatmentFromHistory(args.history),
  ].filter((value): value is string => Boolean(value));

  for (const treatment of inferredTreatmentCandidates) {
    const tokens = tokenize(treatment);
    for (const token of tokens) {
      merged.add(token);
    }
  }

  return deriveImageIntentKeywords(merged);
}

function normalizeIdrPrice(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return raw;

  const compact = raw.toLowerCase().replace(/\s+/g, "");
  const isThousandNotation = /(rb|ribu|k)$/.test(compact);
  const digits = compact.replace(/[^\d]/g, "");
  if (!digits) return raw;

  let amount = Number(digits);
  if (!Number.isFinite(amount) || amount <= 0) return raw;
  if (isThousandNotation) amount *= 1_000;

  return `Rp ${new Intl.NumberFormat("id-ID").format(amount)}`;
}

type TreatmentPriceCatalogEntry = {
  name: string;
  normalizedName: string;
  nameTokens: Set<string>;
  imageUrl: string | null;
  promo: string | null;
  normalMember: string | null;
  normal: string | null;
  special: string | null;
  score: number;
};

function normalizeTreatmentNameForLookup(value: string): string {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\s/+&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTreatmentHeadingName(value: string): string {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/^#{1,6}\s*/, "")
    .replace(/\s*[:|-]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFirstPriceFromLine(value: string): string | null {
  const line = String(value || "").trim();
  if (!line) return null;

  const match =
    line.match(/(rp\.?\s*[0-9][0-9.,]*)/i) ||
    line.match(/([0-9][0-9.,]*\s*(?:rb|ribu|k))/i) ||
    line.match(/([0-9][0-9.,]{2,})/);
  if (!match?.[1]) return null;

  const normalized = normalizeIdrPrice(match[1]);
  return normalized || null;
}

function parseTreatmentHeadingLine(
  value: string,
): { name: string; imageUrl: string | null } | null {
  const raw = String(value || "")
    .replace(/\u00a0/g, " ")
    .trim();
  if (!raw) return null;
  if (/^harga\b/i.test(raw)) return null;

  const normalizedHeading = raw.replace(/^#{1,6}\s*/, "").trim();
  if (!normalizedHeading) return null;

  const inlineUrlMatch = normalizedHeading.match(
    /^(.{2,160}?)(?:\s*:\s*|\s+)(https?:\/\/[^\s)]+)\s*$/i,
  );
  if (inlineUrlMatch?.[1]) {
    const name = cleanTreatmentHeadingName(inlineUrlMatch[1]);
    const imageUrl = normalizeHttpUrl(inlineUrlMatch[2] || "");
    return {
      name,
      imageUrl: imageUrl && isLikelyImageUrl(imageUrl) ? imageUrl : null,
    };
  }

  if (/^#{1,6}\s*/.test(raw)) {
    const name = cleanTreatmentHeadingName(normalizedHeading);
    return name
      ? {
          name,
          imageUrl: null,
        }
      : null;
  }

  return null;
}

function buildTreatmentPriceCatalog(args: {
  knowledgeSources: Array<{ title: string | null; content: string | null }>;
}): TreatmentPriceCatalogEntry[] {
  const candidates: TreatmentPriceCatalogEntry[] = [];

  for (const source of args.knowledgeSources) {
    const plainText = normalizeHtmlToPlainText(String(source.content || ""));
    if (!plainText) continue;
    const lines = plainText
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    let current: {
      name: string;
      imageUrl: string | null;
      lines: string[];
    } | null = null;

    const flushCurrent = () => {
      if (!current) return;

      const normalizedName = normalizeTreatmentNameForLookup(current.name);
      if (!normalizedName) {
        current = null;
        return;
      }

      let promo: string | null = null;
      let normalMember: string | null = null;
      let normal: string | null = null;
      let special: string | null = null;
      for (const line of current.lines) {
        const lower = line.toLowerCase();
        if (!lower.includes("harga")) continue;
        const parsedPrice = parseFirstPriceFromLine(line);
        if (!parsedPrice) continue;

        if (/harga\s+promo/.test(lower)) {
          promo = promo || parsedPrice;
          continue;
        }
        if (/harga\s+normal\s+member/.test(lower)) {
          normalMember = normalMember || parsedPrice;
          continue;
        }
        if (/harga\s+normal/.test(lower)) {
          normal = normal || parsedPrice;
          continue;
        }
        if (/harga\s+(special|spesial)/.test(lower)) {
          special = special || parsedPrice;
        }
      }

      if (!promo && !normalMember && !normal && !special) {
        current = null;
        return;
      }

      const score =
        (promo ? 32 : 0) +
        (normalMember ? 12 : 0) +
        (normal ? 8 : 0) +
        (special ? 5 : 0) +
        (current.imageUrl ? 6 : 0);
      candidates.push({
        name: current.name,
        normalizedName,
        nameTokens: tokenize(normalizedName),
        imageUrl: current.imageUrl,
        promo,
        normalMember,
        normal,
        special,
        score,
      });
      current = null;
    };

    for (const line of lines) {
      const heading = parseTreatmentHeadingLine(line);
      if (heading) {
        flushCurrent();
        current = {
          name: heading.name,
          imageUrl: heading.imageUrl,
          lines: [],
        };
        continue;
      }

      if (!current) continue;
      if (!current.imageUrl) {
        const imageMatch = line.match(/https?:\/\/[^\s)]+/i);
        const candidateUrl = normalizeHttpUrl(imageMatch?.[0] || "");
        if (candidateUrl && isLikelyImageUrl(candidateUrl)) {
          current.imageUrl = candidateUrl;
        }
      }
      current.lines.push(line);
    }
    flushCurrent();
  }

  const dedupedByName = new Map<string, TreatmentPriceCatalogEntry>();
  for (const candidate of candidates) {
    const existing = dedupedByName.get(candidate.normalizedName);
    if (
      !existing ||
      candidate.score > existing.score ||
      (candidate.score === existing.score &&
        Boolean(candidate.imageUrl) &&
        !existing.imageUrl)
    ) {
      dedupedByName.set(candidate.normalizedName, candidate);
    }
  }

  return Array.from(dedupedByName.values());
}

function resolveBestTreatmentCatalogEntry(args: {
  message: string;
  resolvedContent: string;
  history: NormalizedHistoryMessage[];
  catalog: TreatmentPriceCatalogEntry[];
}): TreatmentPriceCatalogEntry | null {
  if (args.catalog.length === 0) return null;

  const inferredKeys = [
    inferTreatmentFromMessage(args.message),
    inferTreatmentFromMessage(args.resolvedContent),
    inferRecentTreatmentFromHistory(args.history),
  ]
    .map((value) => normalizeTreatmentNameForLookup(value || ""))
    .filter(Boolean);
  const scoringCorpus = [
    args.message,
    args.resolvedContent,
    ...args.history.slice(-6).map((item) => item.content),
  ].join("\n");
  const normalizedCorpus = normalizeTreatmentNameForLookup(scoringCorpus);

  let best: { entry: TreatmentPriceCatalogEntry; score: number } | null = null;
  for (const entry of args.catalog) {
    let score = 0;
    if (normalizedCorpus.includes(entry.normalizedName)) score += 24;
    score += scoreByKeywordOverlap(entry.nameTokens, normalizedCorpus) * 4;

    for (const inferredKey of inferredKeys) {
      if (!inferredKey) continue;
      if (inferredKey === entry.normalizedName) {
        score += 42;
        continue;
      }
      if (
        inferredKey.includes(entry.normalizedName) ||
        entry.normalizedName.includes(inferredKey)
      ) {
        score += 28;
        continue;
      }
      const inferredTokens = tokenize(inferredKey);
      score += scoreByKeywordOverlap(inferredTokens, entry.normalizedName) * 8;
    }

    score += Math.floor(entry.score / 8);
    if (!best || score > best.score) {
      best = {
        entry,
        score,
      };
    }
  }

  if (!best || best.score < 10) return null;
  return best.entry;
}

function extractNormalizedPriceMentions(value: string): string[] {
  const mentions = new Set<string>();
  const source = stripInlineImageTokensFromText(String(value || ""));
  if (!source) return [];

  const priceRegexes = [
    /(rp\.?\s*[0-9][0-9.,]*)/gi,
    /([0-9][0-9.,]*\s*(?:rb|ribu|k))/gi,
  ];
  for (const regex of priceRegexes) {
    let match: RegExpExecArray | null = null;
    while ((match = regex.exec(source)) !== null) {
      const raw = String(match[1] || "").trim();
      if (!raw) continue;
      const normalized = normalizeIdrPrice(raw);
      if (normalized) mentions.add(normalized);
    }
  }

  return Array.from(mentions);
}

function isTreatmentNameAligned(left: string, right: string): boolean {
  const leftKey = normalizeTreatmentNameForLookup(left);
  const rightKey = normalizeTreatmentNameForLookup(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  if (leftKey.includes(rightKey) || rightKey.includes(leftKey)) return true;

  const leftTokens = tokenize(leftKey);
  const rightTokens = tokenize(rightKey);
  const overlap =
    scoreByKeywordOverlap(leftTokens, rightKey) +
    scoreByKeywordOverlap(rightTokens, leftKey);
  return overlap >= 2;
}

function buildStrictTreatmentPriceResponse(args: {
  entry: TreatmentPriceCatalogEntry;
  currentContent?: string;
}): string {
  const entry = args.entry;
  const selectedPrice =
    entry.promo || entry.special || entry.normalMember || entry.normal || null;
  if (!selectedPrice) return "";

  const greeting = extractGreetingLine(String(args.currentContent || ""));
  const details: string[] = [];
  if (entry.normal) details.push(`- Harga normal: ${entry.normal}`);
  if (entry.normalMember)
    details.push(`- Harga normal member: ${entry.normalMember}`);
  if (entry.promo) {
    details.push(
      `- Harga promo Flash Sale New Customer April (Khusus Customer Baru): ${entry.promo}`,
    );
  }
  if (entry.special) details.push(`- Harga special: ${entry.special}`);

  const body = [
    ...(greeting ? [greeting] : []),
    `Untuk ${entry.name}, saat ini harganya ${selectedPrice} ya Kak.`,
    "Berikut detail harganya ya Kak:",
    ...details,
  ];
  if (entry.imageUrl) body.push(entry.imageUrl);
  return body.join("\n");
}

function applyStrictTreatmentPriceFormatter(args: {
  message: string;
  history: NormalizedHistoryMessage[];
  currentContent: string;
  knowledgeSources: Array<{ title: string | null; content: string | null }>;
}): string {
  const currentContent = String(args.currentContent || "").trim();
  if (!currentContent) return currentContent;

  const normalizedMessage = String(args.message || "")
    .trim()
    .toLowerCase();
  const hasPriceIntent =
    hasPriceOrPromoCue(normalizedMessage) ||
    hasPriceOrPromoCue(currentContent) ||
    isPriceConfirmationIntent(normalizedMessage);
  if (!hasPriceIntent) return currentContent;

  const catalog = buildTreatmentPriceCatalog({
    knowledgeSources: args.knowledgeSources,
  });
  if (catalog.length === 0) return currentContent;

  const matchedEntry = resolveBestTreatmentCatalogEntry({
    message: args.message,
    resolvedContent: currentContent,
    history: args.history,
    catalog,
  });
  if (!matchedEntry) return currentContent;

  const allowedPrices = new Set(
    [
      matchedEntry.promo,
      matchedEntry.normalMember,
      matchedEntry.normal,
      matchedEntry.special,
    ].filter((value): value is string => Boolean(value)),
  );
  const mentionedPrices = extractNormalizedPriceMentions(currentContent);
  const hasAllowedPrice = mentionedPrices.some((price) =>
    allowedPrices.has(price),
  );
  const hasDisallowedPrice =
    mentionedPrices.length > 0 &&
    mentionedPrices.some((price) => !allowedPrices.has(price));

  const textContent = stripInlineImageTokensFromText(currentContent);
  const responseTreatment = inferTreatmentFromMessage(textContent);
  const hasTreatmentMismatch = Boolean(
    responseTreatment &&
    !isTreatmentNameAligned(responseTreatment, matchedEntry.name),
  );

  const inlineImageUrls = splitInlineContentSegments(currentContent)
    .filter(
      (segment): segment is { type: "image"; url: string } =>
        segment.type === "image",
    )
    .map((segment) => normalizeHttpUrl(segment.url))
    .filter((url): url is string => Boolean(url));
  const hasImage = inlineImageUrls.length > 0;
  const normalizedExpectedImageUrl = normalizeHttpUrl(
    matchedEntry.imageUrl || "",
  );
  const hasDisallowedImage = Boolean(
    normalizedExpectedImageUrl &&
    inlineImageUrls.some((url) => url !== normalizedExpectedImageUrl),
  );

  if (
    hasTreatmentMismatch ||
    hasDisallowedPrice ||
    !hasAllowedPrice ||
    hasDisallowedImage
  ) {
    const strictResponse = buildStrictTreatmentPriceResponse({
      entry: matchedEntry,
      currentContent,
    });
    return strictResponse || currentContent;
  }

  if (
    normalizedExpectedImageUrl &&
    !hasImage &&
    /(detail harg|harga|promo|flash sale|diskon)/i.test(textContent)
  ) {
    return `${currentContent}\n${normalizedExpectedImageUrl}`;
  }

  return currentContent;
}

function extractTreatmentPriceContext(args: {
  treatment: string;
  knowledgeSources: Array<{ title: string | null; content: string | null }>;
}): {
  promo: string | null;
  normalMember: string | null;
  normal: string | null;
} | null {
  const treatment = String(args.treatment || "").trim();
  if (!treatment) return null;

  const catalog = buildTreatmentPriceCatalog({
    knowledgeSources: args.knowledgeSources,
  });
  if (catalog.length === 0) return null;
  const normalizedTreatment = normalizeTreatmentNameForLookup(treatment);
  if (!normalizedTreatment) return null;
  const treatmentTokens = tokenize(normalizedTreatment);

  const best = catalog
    .map((entry) => {
      let score = 0;
      if (entry.normalizedName === normalizedTreatment) score += 40;
      else if (
        entry.normalizedName.includes(normalizedTreatment) ||
        normalizedTreatment.includes(entry.normalizedName)
      ) {
        score += 24;
      }
      score +=
        scoreByKeywordOverlap(treatmentTokens, entry.normalizedName) * 10;
      score += Math.floor(entry.score / 8);
      return {
        entry,
        score,
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.entry;
  if (!best) return null;

  return {
    promo: best.promo,
    normalMember: best.normalMember,
    normal: best.normal,
  };
}

function toTitleCaseWords(value: string): string {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .map(
      (token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase(),
    )
    .join(" ");
}

function buildDeterministicSingleTreatmentPriceResponse(args: {
  message: string;
  history: NormalizedHistoryMessage[];
  resolvedContent: string;
  knowledgeSources: Array<{ title: string | null; content: string | null }>;
}): string | null {
  const normalizedMessage = String(args.message || "")
    .trim()
    .toLowerCase();
  if (!normalizedMessage) return null;
  if (isPackageInquiryIntent(normalizedMessage)) return null;

  const normalizedResolvedContent = String(args.resolvedContent || "")
    .trim()
    .toLowerCase();
  const hasPriceIntent =
    /\b(harga|price|biaya)\b/.test(normalizedMessage) ||
    /\b(promo|flash sale|flash-sale|diskon)\b/.test(normalizedMessage) ||
    isPriceConfirmationIntent(normalizedMessage) ||
    hasPriceOrPromoCue(normalizedResolvedContent);
  if (!hasPriceIntent) return null;

  const treatmentCandidate =
    inferTreatmentFromMessage(args.message) ||
    inferTreatmentFromMessage(args.resolvedContent) ||
    inferRecentTreatmentFromHistory(args.history);
  if (!treatmentCandidate) return null;

  const priceContext = extractTreatmentPriceContext({
    treatment: treatmentCandidate,
    knowledgeSources: args.knowledgeSources,
  });
  if (!priceContext) return null;
  const selectedPrice =
    priceContext.promo || priceContext.normalMember || priceContext.normal;
  if (!selectedPrice) return null;

  const treatmentDisplay = toTitleCaseWords(treatmentCandidate);
  return [
    `Untuk ${treatmentDisplay}, saat ini harganya ${selectedPrice} ya Kak.`,
    "Berikut detail harganya ya Kak:",
  ].join("\n");
}

function shouldApplyDeterministicPriceFallback(args: {
  message: string;
  history: NormalizedHistoryMessage[];
  modelContent: string | null;
  currentResolvedContent: string;
}): boolean {
  const modelContent = toNullableString(args.modelContent);
  if (!modelContent) return true;

  const current = String(args.currentResolvedContent || "").trim();
  if (!current) return true;
  if (hasMainResponseLeakage(current)) return true;

  const normalizedMessage = String(args.message || "")
    .trim()
    .toLowerCase();
  if (!normalizedMessage) return false;

  const confirmationIntent = isPriceConfirmationIntent(normalizedMessage);
  if (!confirmationIntent) return false;
  if (isFirstUserTurn(args.history)) return false;

  const hasPriceNominal = /\brp\.?\s*\d[\d.,]*|\b\d{2,5}\s*(rb|ribu|k)\b/i.test(
    current,
  );
  return !hasPriceNominal;
}

function scoreByKeywordOverlap(keywords: Set<string>, content: string): number {
  if (keywords.size === 0) return 0;
  const haystack = tokenize(content);
  let score = 0;
  for (const keyword of keywords) {
    if (haystack.has(keyword)) score += 1;
  }
  return score;
}

function containsAnyKeyword(text: string, keywords: string[]): boolean {
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}

const LOCATION_INTENT_KEYWORDS = [
  "cabang",
  "alamat",
  "lokasi",
  "location",
  "tempat",
  "terdekat",
  "nearest",
  "kecamatan",
  "kelurahan",
  "kabupaten",
  "kota",
  "jalan",
  "jl",
  "map",
  "maps",
];

const LOCATION_TOOL_HINT_KEYWORDS = [
  "location",
  "lokasi",
  "cabang",
  "branch",
  "alamat",
  "map",
  "maps",
  "kota",
  "kecamatan",
  "kelurahan",
  "kabupaten",
  "area",
  "daerah",
];

const LOCATION_PARAMETER_HINT_KEYWORDS = [
  "location",
  "lokasi",
  "cabang",
  "branch",
  "alamat",
  "address",
  "city",
  "kota",
  "kecamatan",
  "kelurahan",
  "kabupaten",
  "area",
  "region",
];

const LOCATION_VALUE_STOPWORDS = new Set([
  "saya",
  "kami",
  "kita",
  "aku",
  "tempat",
  "tempatnya",
  "sama",
  "beda",
  "atau",
  "ato",
  "di",
  "yang",
  "mana",
  "nih",
  "kak",
  "kaka",
  "kakak",
  "domisili",
  "lokasi",
  "alamat",
  "cabang",
]);

const NON_GEOGRAPHIC_LOCATION_LEADING_TOKENS = new Set([
  "iya",
  "ya",
  "ok",
  "oke",
  "baik",
  "boleh",
  "mau",
  "tertarik",
  "minat",
  "siap",
  "thanks",
  "thank",
  "makasih",
  "terima",
  "halo",
  "hai",
  "weekend",
  "weekday",
  "weekdays",
  "today",
  "tomorrow",
  "hari",
  "senin",
  "selasa",
  "rabu",
  "kamis",
  "jumat",
  "sabtu",
  "minggu",
  "jam",
  "pagi",
  "siang",
  "sore",
  "malam",
  "book",
  "booking",
]);

const LOCATION_REPLY_EXCLUSION_KEYWORDS = [
  "promo",
  "harga",
  "price",
  "treatment",
  "ipl",
  "acne",
  "skin",
  "hair",
  "voucher",
  "booking",
  "jadwal",
  "weekend",
  "weekday",
  "weekdays",
  "konsultasi",
];

function isLocationParameterKey(value: string): boolean {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return containsAnyKeyword(normalized, LOCATION_PARAMETER_HINT_KEYWORDS);
}

function toDisplayLocationLabel(value: string): string {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return "";
  return normalized.replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function startsWithNonGeographicLocationToken(value: string): boolean {
  const firstToken = String(value || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)[0];
  if (!firstToken) return false;
  return NON_GEOGRAPHIC_LOCATION_LEADING_TOKENS.has(firstToken);
}

function normalizeLocationCandidate(value: string): string | null {
  const normalized = String(value || "")
    .replace(/[^\p{L}\p{N}\s.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  if (normalized.length < 3) return null;
  if (normalized.length > 64) return null;
  const asLower = normalized.toLowerCase();
  if (LOCATION_VALUE_STOPWORDS.has(asLower)) return null;
  if (startsWithNonGeographicLocationToken(asLower)) return null;
  return normalized;
}

function extractLocationMentionFromText(message: string): string | null {
  const source = String(message || "").trim();
  if (!source) return null;
  const normalized = source.toLowerCase();

  const patterns = [
    /\b(?:di|domisili|lokasi|area|daerah|kota|kabupaten|kecamatan|kelurahan)\s+([a-z0-9][a-z0-9 .,'-]{1,48})/i,
    /\b(?:jaktim|jakbar|jakpus|jakut|jaksel)\b/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const candidate = normalizeLocationCandidate(match[1] || match[0] || "");
    if (candidate) return candidate;
  }

  if (/^[a-z0-9 .,'-]{3,48}$/i.test(normalized)) {
    const tokenCount = normalized
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean).length;
    if (tokenCount > 3) return null;
    if (containsAnyKeyword(normalized, LOCATION_REPLY_EXCLUSION_KEYWORDS))
      return null;
    const candidate = normalizeLocationCandidate(normalized);
    if (
      candidate &&
      !containsAnyKeyword(candidate.toLowerCase(), LOCATION_INTENT_KEYWORDS)
    ) {
      return candidate;
    }
  }

  return null;
}

function inferLocationIntent(args: { message: string }): boolean {
  // Strict mode: only run location tool when current user message explicitly asks location.
  return isLocationIntentMessage(args.message);
}

function isLocationToolName(toolName: string): boolean {
  const normalized = normalizeToolLookupKey(toolName);
  return (
    normalized.includes("get_location_branch") ||
    normalized.includes("location") ||
    normalized.includes("cabang") ||
    normalized.includes("branch")
  );
}

function resolveConversationLocation(args: {
  message: string;
  history: NormalizedHistoryMessage[];
}): string | null {
  const currentMessageLocation = extractLocationMentionFromText(args.message);
  if (currentMessageLocation) return currentMessageLocation;

  for (let index = args.history.length - 1; index >= 0; index -= 1) {
    const item = args.history[index];
    if (item.role !== "user") continue;
    const fromHistory = extractLocationMentionFromText(item.content);
    if (fromHistory) return fromHistory;
  }

  return null;
}

function buildToolLookupContext(tool: APIToolRecord): string {
  const requiredKeys = Array.isArray(tool.required)
    ? tool.required.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const propertyTokens = toRecordArray(tool.properties).flatMap((property) => {
    const name = toNullableString(property.name);
    const description = toNullableString(property.description);
    const enumValues = Array.isArray(property.enum)
      ? property.enum.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    return [name, description, ...enumValues].filter((item): item is string =>
      Boolean(item),
    );
  });

  return [tool.name, tool.description, ...requiredKeys, ...propertyTokens]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" ");
}

function isLocationIntentMessage(message: string): boolean {
  const normalized = String(message || "")
    .trim()
    .toLowerCase();
  if (!normalized) return false;

  if (containsAnyKeyword(normalized, LOCATION_INTENT_KEYWORDS)) return true;

  const locationPhraseMatch = normalized.match(
    /\b(?:di|daerah|area|kecamatan|kelurahan|kota|kabupaten|alamat)\s+([a-z0-9][a-z0-9 .,'-]{1,40})\b/i,
  );
  if (locationPhraseMatch) {
    const locationCandidate = normalizeLocationCandidate(
      locationPhraseMatch[1] || "",
    );
    if (locationCandidate) return true;
  }

  if (/\b(?:dekat|terdekat|nearest)\s+(?:di|ke)\b/i.test(normalized)) {
    return true;
  }

  return false;
}

function isLocationToolContext(toolContext: string): boolean {
  return containsAnyKeyword(toolContext, LOCATION_TOOL_HINT_KEYWORDS);
}

function scoreToolRelevance(args: {
  tool: APIToolRecord;
  message: string;
  messageKeywords: Set<string>;
  history: NormalizedHistoryMessage[];
  locationIntent: boolean;
}): { relevance: number; isLocationCandidate: boolean } {
  const lookupContext = buildToolLookupContext(args.tool);
  const keywordScore = scoreByKeywordOverlap(
    args.messageKeywords,
    lookupContext,
  );

  const isLocationCandidate = isLocationToolContext(lookupContext);
  const locationBoost = args.locationIntent && isLocationCandidate ? 6 : 0;

  const firstTurnBoost =
    args.history.length === 0 && /greet|welcome|halo/i.test(args.tool.name)
      ? 1
      : 0;

  return {
    relevance: keywordScore + locationBoost + firstTurnBoost,
    isLocationCandidate,
  };
}

function isPromoInfoIntent(message: string): boolean {
  return containsAnyKeyword(message, [
    "promo",
    "intimate glow",
    "harga",
    "biaya",
    "biayanya",
    "price",
    "399rb",
    "399 rb",
    "flash sale",
  ]);
}

function isBriefConversationalIntent(message: string): boolean {
  const normalized = String(message || "")
    .trim()
    .toLowerCase();
  if (!normalized) return false;

  const tokenCount = normalized.split(/\s+/).filter(Boolean).length;
  if (tokenCount > 5) return false;

  return containsAnyKeyword(normalized, [
    "halo",
    "hai",
    "hi",
    "pagi",
    "siang",
    "sore",
    "malam",
    "thanks",
    "thank you",
    "makasih",
    "terima kasih",
    "ok",
    "oke",
    "sip",
    "ya",
    "iya",
  ]);
}

function isPackageInquiryIntent(message: string): boolean {
  return containsAnyKeyword(message, [
    "paket",
    "package",
    "combo",
    "bundle",
    "bundling",
    "berulang",
    "3x",
    "6x",
    "10x",
  ]);
}

function resolveAdaptiveReplyCharLimit(args: {
  message: string;
  baseLimit: number;
  locationResponseWithFallback: boolean;
}): number {
  const normalizedBaseLimit = clampNumber(
    args.baseLimit,
    AI_REPLY_CHAR_LIMIT_DEFAULT,
    300,
    12_000,
  );
  const normalizedMessage = String(args.message || "")
    .trim()
    .toLowerCase();
  if (!normalizedMessage) return normalizedBaseLimit;

  if (args.locationResponseWithFallback) {
    return Math.max(normalizedBaseLimit, 8_000);
  }

  const detailedInfoIntent =
    isServiceCatalogIntent(normalizedMessage) ||
    isPromoInfoIntent(normalizedMessage) ||
    isPackageInquiryIntent(normalizedMessage) ||
    containsAnyKeyword(normalizedMessage, [
      "detail",
      "jelasin",
      "jelaskan",
      "rinci",
      "rincian",
      "list",
      "daftar",
      "manfaat",
      "benefit",
      "berapa",
      "harga",
      "biaya",
      "price",
    ]);

  if (detailedInfoIntent) {
    return Math.max(normalizedBaseLimit, 6_500);
  }

  if (isBriefConversationalIntent(normalizedMessage)) {
    return Math.min(normalizedBaseLimit, 2_000);
  }

  return normalizedBaseLimit;
}

function hasRecurringPackageOffer(content: string): boolean {
  return /\bpaket\b|\bberulang\b|\bcombo\b|\bbundle\b/i.test(
    String(content || ""),
  );
}

function appendOfferBeforeLocationPrompt(
  content: string,
  offer: string,
): string {
  const normalizedContent = String(content || "").trim();
  const normalizedOffer = String(offer || "").trim();
  if (!normalizedContent || !normalizedOffer)
    return normalizedContent || normalizedOffer;

  const locationPromptPattern =
    /(kalau boleh tahu[^.\n!?]*domisili[^.\n!?]*\??[^\n]*|kakak berdomisili di mana[^.\n!?]*\??[^\n]*)/i;
  const match = normalizedContent.match(locationPromptPattern);
  if (!match) {
    return `${normalizedContent}\n\n${normalizedOffer}`.trim();
  }

  const target = match[0];
  return normalizedContent.replace(target, `${normalizedOffer}\n\n${target}`);
}

function isExplicitHandoffIntent(message: string): boolean {
  const normalized = String(message || "").toLowerCase();
  const asksAiVsHumanIdentity =
    /\b(ai|a\.i\.|bot|chatbot)\b/.test(normalized) &&
    /\b(manusia|human|orang|admin|cs|customer service)\b/.test(normalized) &&
    (/[?]/.test(normalized) ||
      /\b(atau|apa|kah|bener|benar|real|asli|bukan)\b/.test(normalized));
  if (asksAiVsHumanIdentity) return true;

  return containsAnyKeyword(message, [
    "jadwal",
    "schedule",
    "reschedule",
    "cancel",
    "batal",
    "komplain",
    "keluhan",
    "kecewa",
    "hamil",
    "menyusui",
    "auto immune",
    "efek samping",
  ]);
}

function toJsonString(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/g, "")}/${path.replace(/^\/+/, "")}`;
}

function extractMessageContent(payload: unknown): string | null {
  if (typeof payload === "string" && payload.trim()) return payload.trim();
  if (!payload || typeof payload !== "object") return null;

  const choices = (payload as Record<string, unknown>).choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0] as Record<string, unknown>;
    const message = toRecord(first.message);
    const direct = toNullableString(message?.content);
    if (direct) return direct;

    if (Array.isArray(message?.content)) {
      const chunks = (message?.content as unknown[])
        .map((chunk) => {
          const record = toRecord(chunk);
          return toNullableString(record?.text) || "";
        })
        .filter(Boolean);
      if (chunks.length > 0) return chunks.join("\n").trim();
    }
  }

  const outputText = toNullableString(
    (payload as Record<string, unknown>).output_text,
  );
  if (outputText) return outputText;

  return null;
}

function normalizeToolMethod(
  value: unknown,
): "GET" | "POST" | "PUT" | "PATCH" | "DELETE" {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (
    normalized === "GET" ||
    normalized === "POST" ||
    normalized === "PUT" ||
    normalized === "PATCH" ||
    normalized === "DELETE"
  ) {
    return normalized;
  }
  return "POST";
}

function extractPayloadValueFromMessage(args: {
  message: string;
  key: string;
  enumValues: string[];
}): string | null {
  const loweredMessage = args.message.toLowerCase();

  for (const enumValue of args.enumValues) {
    if (!enumValue) continue;
    if (loweredMessage.includes(enumValue.toLowerCase())) {
      return enumValue;
    }
  }

  const escapedKey = args.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escapedKey}\\s*[:=]\\s*([^,\\n\\r]+)`, "i");
  const match = args.message.match(regex);
  if (match?.[1]) {
    const extracted = match[1].trim();
    return extracted.length > 0 ? extracted : null;
  }

  return null;
}

async function executeApiTool(args: {
  tool: APIToolRecord;
  message: string;
  history: NormalizedHistoryMessage[];
  locationHint?: string | null;
}): Promise<ToolExecutionResult> {
  const method = normalizeToolMethod(args.tool.method);
  const webhookAddress = toNullableString(args.tool.webhook_address);

  if (!webhookAddress) {
    return {
      toolId: args.tool.id,
      toolName: args.tool.name,
      method,
      url: "",
      ok: false,
      skipped: true,
      status: null,
      error: "Missing webhook address",
      responsePreview: null,
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(webhookAddress);
  } catch {
    return {
      toolId: args.tool.id,
      toolName: args.tool.name,
      method,
      url: webhookAddress,
      ok: false,
      skipped: true,
      status: null,
      error: "Invalid webhook URL",
      responsePreview: null,
    };
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return {
      toolId: args.tool.id,
      toolName: args.tool.name,
      method,
      url: parsedUrl.toString(),
      ok: false,
      skipped: true,
      status: null,
      error: "Unsupported webhook protocol",
      responsePreview: null,
    };
  }

  const payload: Record<string, unknown> = {};
  const properties = toRecordArray(args.tool.properties);
  const requiredKeys = Array.isArray(args.tool.required)
    ? args.tool.required
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    : [];

  for (const property of properties) {
    const propertyName = toNullableString(property.name);
    if (!propertyName) continue;

    const enumValues = Array.isArray(property.enum)
      ? property.enum.map((item) => String(item || "").trim()).filter(Boolean)
      : [];

    const extracted = extractPayloadValueFromMessage({
      message: args.message,
      key: propertyName,
      enumValues,
    });
    if (extracted) {
      payload[propertyName] = extracted;
      continue;
    }
    if (args.locationHint && isLocationParameterKey(propertyName)) {
      payload[propertyName] = args.locationHint;
    }
  }

  for (const requiredKey of requiredKeys) {
    if (payload[requiredKey] !== undefined) continue;

    if (args.locationHint && isLocationParameterKey(requiredKey)) {
      payload[requiredKey] = args.locationHint;
      continue;
    }

    if (requiredKeys.length === 1) {
      if (isLocationParameterKey(requiredKey)) {
        return {
          toolId: args.tool.id,
          toolName: args.tool.name,
          method,
          url: parsedUrl.toString(),
          ok: false,
          skipped: true,
          status: null,
          error: `Missing required location parameter: ${requiredKey}`,
          responsePreview: null,
        };
      }
      payload[requiredKey] = args.message;
      continue;
    }

    return {
      toolId: args.tool.id,
      toolName: args.tool.name,
      method,
      url: parsedUrl.toString(),
      ok: false,
      skipped: true,
      status: null,
      error: `Missing required parameter: ${requiredKey}`,
      responsePreview: null,
    };
  }

  const additionalPayload = toRecordArray(args.tool.additional_payload);
  for (const item of additionalPayload) {
    const key = toNullableString(item.key);
    if (!key || payload[key] !== undefined) continue;
    payload[key] = item.value ?? null;
  }

  if (payload.message === undefined) payload.message = args.message;
  if (payload.user_message === undefined) payload.user_message = args.message;
  if (payload.history === undefined && args.history.length > 0) {
    payload.history = args.history;
  }

  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
  };

  const apiKey = toNullableString(args.tool.api_key);
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  const authorizationKey = toNullableString(args.tool.authorizationKey);
  if (authorizationKey) {
    headers.Authorization = /^Bearer\s+/i.test(authorizationKey)
      ? authorizationKey
      : `Bearer ${authorizationKey}`;
  }

  let requestUrl = parsedUrl.toString();
  let body: string | undefined;

  if (method === "GET") {
    for (const [key, value] of Object.entries(payload)) {
      parsedUrl.searchParams.set(key, toJsonString(value, ""));
    }
    requestUrl = parsedUrl.toString();
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(payload);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);

  try {
    const response = await fetch(requestUrl, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    const responseText = await response.text();
    const previewLimit = isLocationToolName(args.tool.name) ? 8_000 : 1_000;
    const preview = truncateText(responseText.trim(), previewLimit);

    return {
      toolId: args.tool.id,
      toolName: args.tool.name,
      method,
      url: requestUrl,
      ok: response.ok,
      skipped: false,
      status: response.status,
      error: response.ok
        ? null
        : `HTTP ${response.status} ${response.statusText}`,
      responsePreview: preview || null,
    };
  } catch (error) {
    return {
      toolId: args.tool.id,
      toolName: args.tool.name,
      method,
      url: requestUrl,
      ok: false,
      skipped: false,
      status: null,
      error: error instanceof Error ? error.message : "Tool request failed",
      responsePreview: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveProviderRuntime(args: {
  appId: string;
  chatbot: ChatbotSnapshot;
}): Promise<ProviderRuntime> {
  const [settings, runtimeProvider] = await Promise.all([
    AIService.getSettings(args.appId).catch(() => null),
    AIService.getRuntimeProviderConfig("completion").catch(() => null),
  ]);

  const provider =
    toNullableString(runtimeProvider?.provider) ||
    toNullableString(settings?.model_provider) ||
    toNullableString(process.env.AI_PROVIDER);

  const baseUrl =
    toNullableString(runtimeProvider?.base_url) ||
    toNullableString(settings?.api_endpoint) ||
    toNullableString(process.env.AZURE_OPENAI_ENDPOINT);

  const apiKey =
    toNullableString(runtimeProvider?.api_key) ||
    toNullableString(settings?.api_key) ||
    toNullableString(process.env.AZURE_OPENAI_API_KEY) ||
    toNullableString(process.env.OPENAI_API_KEY);

  const apiVersion =
    toNullableString(runtimeProvider?.api_version) ||
    toNullableString(settings?.api_version) ||
    "2024-02-15-preview";

  const deploymentName =
    toNullableString(runtimeProvider?.deployment_name) ||
    toNullableString(settings?.deployment_name) ||
    toNullableString(process.env.AZURE_OPENAI_DEPLOYMENT);

  let modelName =
    toNullableString(settings?.model_name) ||
    toNullableString(args.chatbot.model) ||
    toNullableString(runtimeProvider?.model_name) ||
    toNullableString(process.env.AI_MODEL) ||
    "gpt-5.4";

  // Apply growthcircle plan_type suffix to ensure correct model ID
  if (
    (provider || "").toLowerCase() === "growthcircle" &&
    runtimeProvider
  ) {
    const planType =
      (runtimeProvider as Record<string, unknown>).plan_type || "free";
    if (planType === "paid") {
      modelName = modelName.replace(/-free$/, "");
    } else if (planType === "free" && !modelName.endsWith("-free")) {
      modelName = `${modelName}-free`;
    }
  }

  const temperature = clampNumber(
    args.chatbot.temperature ??
      runtimeProvider?.temperature ??
      settings?.temperature,
    0.2,
    0,
    2,
  );

  const configuredMaxTokens = clampNumber(
    runtimeProvider?.max_tokens ?? settings?.max_tokens,
    600,
    128,
    4_096,
  );
  const minTokensFromMessageLimit = estimateMinResponseTokensFromChars(
    AI_REPLY_CHAR_LIMIT_DEFAULT,
  );
  const maxTokens = Math.max(configuredMaxTokens, minTokensFromMessageLimit);

  return {
    provider,
    baseUrl,
    apiKey,
    apiVersion,
    deploymentName,
    modelName,
    temperature,
    maxTokens,
  };
}

function estimateTokensFromText(value: string): number {
  const normalized = String(value || "").trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function estimateUsageFromMessages(args: {
  messages: Array<{ role: string; content: string }>;
  completionText: string;
}): UsageStats {
  const promptTokens = args.messages.reduce(
    (sum, message) => sum + estimateTokensFromText(message.content),
    0,
  );
  const completionTokens = estimateTokensFromText(args.completionText);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
}

function parseUsageFromProviderPayload(payload: unknown): UsageStats | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return null;
  const usage = (payload as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const usageRecord = usage as Record<string, unknown>;
  const promptTokensRaw = Number(
    usageRecord.prompt_tokens ??
      usageRecord.input_tokens ??
      usageRecord.promptTokens ??
      0,
  );
  const completionTokensRaw = Number(
    usageRecord.completion_tokens ??
      usageRecord.output_tokens ??
      usageRecord.completionTokens ??
      0,
  );
  const totalTokensRaw = Number(
    usageRecord.total_tokens ??
      usageRecord.totalTokens ??
      promptTokensRaw + completionTokensRaw,
  );
  if (
    !Number.isFinite(promptTokensRaw) &&
    !Number.isFinite(completionTokensRaw) &&
    !Number.isFinite(totalTokensRaw)
  ) {
    return null;
  }
  const promptTokens = Math.max(0, Math.trunc(promptTokensRaw || 0));
  const completionTokens = Math.max(0, Math.trunc(completionTokensRaw || 0));
  const totalTokens = Math.max(
    0,
    Math.trunc(totalTokensRaw || promptTokens + completionTokens),
  );
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens:
      totalTokens > 0 ? totalTokens : promptTokens + completionTokens,
  };
}

function resolveUsageWithFallback(args: {
  payload: unknown;
  estimatedUsage: UsageStats;
  completionText: string;
}): UsageStats {
  const providerUsage = parseUsageFromProviderPayload(args.payload);
  if (providerUsage) {
    const fallbackCompletion = estimateTokensFromText(args.completionText);
    const completion =
      providerUsage.completion_tokens > 0
        ? providerUsage.completion_tokens
        : fallbackCompletion;
    const total =
      providerUsage.total_tokens > 0
        ? providerUsage.total_tokens
        : providerUsage.prompt_tokens + completion;
    return {
      prompt_tokens: providerUsage.prompt_tokens,
      completion_tokens: completion,
      total_tokens: total,
    };
  }

  const fallbackCompletion = estimateTokensFromText(args.completionText);
  return {
    prompt_tokens: args.estimatedUsage.prompt_tokens,
    completion_tokens:
      args.estimatedUsage.completion_tokens > 0
        ? args.estimatedUsage.completion_tokens
        : fallbackCompletion,
    total_tokens:
      args.estimatedUsage.prompt_tokens +
      (args.estimatedUsage.completion_tokens > 0
        ? args.estimatedUsage.completion_tokens
        : fallbackCompletion),
  };
}

async function requestModelResponse(args: {
  runtime: ProviderRuntime;
  systemPrompt: string;
  history: NormalizedHistoryMessage[];
  message: string;
}): Promise<ModelResponseResult> {
  const llmMessages = [
    {
      role: "system",
      content: args.systemPrompt,
    },
    ...args.history.map((item) => ({ role: item.role, content: item.content })),
    {
      role: "user",
      content: args.message,
    },
  ];
  const estimatedUsage = estimateUsageFromMessages({
    messages: llmMessages.map((item) => ({
      role: item.role,
      content: item.content,
    })),
    completionText: "",
  });

  let endpoint: string | null = null;
  if (!args.runtime.baseUrl || !args.runtime.apiKey) {
    return {
      content: null,
      usage: estimatedUsage,
      trace: {
        endpoint: null,
        status_code: null,
        hit: false,
        error: "missing_runtime_credentials",
      },
    };
  }

  const isAzure =
    (args.runtime.provider || "").toLowerCase() === "azure" ||
    args.runtime.baseUrl.includes(".openai.azure.com");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    if (isAzure) {
      const deployment = args.runtime.deploymentName || args.runtime.modelName;
      endpoint = joinUrl(
        args.runtime.baseUrl,
        `openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(args.runtime.apiVersion || "2024-02-15-preview")}`,
      );

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": args.runtime.apiKey,
        },
        body: JSON.stringify({
          messages: llmMessages,
          temperature: args.runtime.temperature,
          max_tokens: args.runtime.maxTokens,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          content: null,
          usage: estimatedUsage,
          trace: {
            endpoint,
            status_code: response.status,
            hit: false,
            error: `HTTP ${response.status} ${response.statusText}`,
          },
        };
      }

      const payload = (await response.json().catch(() => null)) as unknown;
      const content = extractMessageContent(payload);
      return {
        content,
        usage: resolveUsageWithFallback({
          payload,
          estimatedUsage,
          completionText: content || "",
        }),
        trace: {
          endpoint,
          status_code: response.status,
          hit: true,
          error: null,
        },
      };
    }

    const baseUrlEndsWithVersion = /\/v\d+\/?$/i.test(args.runtime.baseUrl);
    endpoint = joinUrl(
      args.runtime.baseUrl,
      baseUrlEndsWithVersion ? "/chat/completions" : "/v1/chat/completions",
    );
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.runtime.apiKey}`,
      },
      body: JSON.stringify({
        model: args.runtime.modelName,
        messages: llmMessages,
        temperature: args.runtime.temperature,
        max_tokens: args.runtime.maxTokens,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        content: null,
        usage: estimatedUsage,
        trace: {
          endpoint,
          status_code: response.status,
          hit: false,
          error: `HTTP ${response.status} ${response.statusText}`,
        },
      };
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    const content = extractMessageContent(payload);
    return {
      content,
      usage: resolveUsageWithFallback({
        payload,
        estimatedUsage,
        completionText: content || "",
      }),
      trace: {
        endpoint,
        status_code: response.status,
        hit: true,
        error: null,
      },
    };
  } catch (error) {
    return {
      content: null,
      usage: estimatedUsage,
      trace: {
        endpoint,
        status_code: null,
        hit: false,
        error: error instanceof Error ? error.message : "provider_request_failed",
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeFollowups(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value
      .filter(
        (item) => item && typeof item === "object" && !Array.isArray(item),
      )
      .map((item) => ({ ...(item as Record<string, unknown>) }));
  }

  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .filter(
            (item) => item && typeof item === "object" && !Array.isArray(item),
          )
          .map((item) => ({ ...(item as Record<string, unknown>) }));
      }
    } catch {
      return [];
    }
  }

  return [];
}

function hasMainResponseLeakage(value: string): boolean {
  const source = String(value || "");
  if (!source.trim()) return false;
  const normalized = source.toLowerCase();

  const directLeakPatterns = [
    /\bberdasarkan knowledge\b/i,
    /\bknowledge\s*["“][^"”]{0,120}["”]/i,
    /\bresponse templates?\b/i,
    /\bobjection handling\b/i,
    /\bconcern identification\b/i,
    /\buncertain customer\b/i,
    /\bbudget concerns?\b/i,
    /\bcore identity\b/i,
    /\btone of voice\b/i,
    /\bcommunication style\b/i,
    /\bagent transfer conditions?\b/i,
    /\[treatment [a-z]\]/i,
    /\[benefit\]/i,
  ];

  return directLeakPatterns.some((pattern) => pattern.test(normalized));
}

function sanitizeAssistantResponseForDelivery(value: string): string {
  const source = String(value || "")
    .replace(/\r/g, "\n")
    .trim();
  if (!source) return "";

  const leakDetected = hasMainResponseLeakage(source);
  const lineLeakPatterns = [
    /^\s*#+\s*(response templates?|objection handling|concern identification)\b/i,
    /\bresponse templates?\b/i,
    /\bobjection handling\b/i,
    /\bconcern identification\b/i,
    /\buncertain customer\b/i,
    /\bbudget concerns?\b/i,
    /\[treatment [a-z]\]/i,
    /\[benefit\]/i,
    /\bmenu_member_non_a4\b/i,
    /\barea_1_compressed\b/i,
  ];

  const kept: string[] = [];
  const pushBlankLine = () => {
    if (kept.length === 0) return;
    if (kept[kept.length - 1] === "") return;
    kept.push("");
  };

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      pushBlankLine();
      continue;
    }

    if (lineLeakPatterns.some((pattern) => pattern.test(line))) continue;
    if (/\[[^\]]+\]\s*(?:→|->)\s*\[[^\]]+\]/.test(line)) continue;

    const urls = line.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    if (urls.length > 0) {
      const hasNonImageUrl = urls.some((url) => {
        const normalized = normalizeHttpUrl(url);
        if (!normalized) return true;
        return !isLikelyImageUrl(normalized);
      });
      if (leakDetected && hasNonImageUrl) continue;
    }

    const cleaned = line
      .replace(
        /\b(?:Concern Identification|Uncertain Customer(?:\s*\([^)]*\))?|Budget Concerns?(?:\s*\([^)]*\))?)\s*:\s*/gi,
        "",
      )
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!cleaned) continue;
    kept.push(cleaned);
  }

  let sanitized = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  sanitized = sanitized
    .replace(/^berdasarkan knowledge[^:\n]{0,140}:\s*/i, "")
    .trim();

  if (hasMainResponseLeakage(sanitized)) {
    sanitized = sanitized
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !lineLeakPatterns.some((pattern) => pattern.test(line)))
      .join("\n")
      .trim();
  }

  return sanitized;
}

function buildSafeKnowledgeSnippetForFallback(args: {
  message: string;
  knowledge: KnowledgeContextItem;
}): string | null {
  const plainContent = stripHtml(String(args.knowledge.content || ""));
  if (!plainContent) return null;
  const messageKeywords = tokenize(args.message);
  const phraseHints = extractPhraseHints(args.message);
  const extracted = extractRelevantKnowledgeWindow(
    plainContent,
    messageKeywords,
    520,
    phraseHints,
  );
  const sanitized = sanitizeAssistantResponseForDelivery(
    extracted || plainContent,
  );
  if (!sanitized) return null;
  return truncateText(sanitized, 420);
}

function buildFallbackResponse(args: {
  chatbot: ChatbotSnapshot;
  message: string;
  knowledge: KnowledgeContextItem[];
  toolRuns: ToolExecutionResult[];
  history: NormalizedHistoryMessage[];
}): string {
  const greeting =
    args.chatbot.welcome_msg || `Halo, saya ${args.chatbot.name}.`;
  const successfulTool = args.toolRuns.find(
    (item) => item.ok && item.responsePreview,
  );
  if (successfulTool?.responsePreview) {
    const sanitizedToolPreview = sanitizeAssistantResponseForDelivery(
      decodeAssistantPayloadText(String(successfulTool.responsePreview || "")),
    );
    if (sanitizedToolPreview) {
      return [
        greeting,
        "Saya sudah cek data pendukung yang relevan.",
        truncateText(sanitizedToolPreview, 520),
      ].join("\n\n");
    }
  }

  const isFirstTurn = args.history.length === 0;
  if (isFirstTurn && args.chatbot.welcome_msg) {
    return `${args.chatbot.welcome_msg}\n\nAda yang ingin kamu tanyakan lebih detail?`;
  }

  return [
    greeting,
    "Saya siap bantu untuk pertanyaan Kakak. Boleh jelaskan kebutuhan utama Kakak supaya saya bisa kasih jawaban yang paling tepat?",
  ].join(" ");
}

function decodeAssistantPayloadText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      const firstAssistant = parsed.find((item) => {
        if (!item || typeof item !== "object") return false;
        const role = String(
          (item as Record<string, unknown>).role || "",
        ).toLowerCase();
        const content = (item as Record<string, unknown>).content;
        return role === "assistant" && typeof content === "string";
      }) as Record<string, unknown> | undefined;
      if (firstAssistant && typeof firstAssistant.content === "string") {
        return String(firstAssistant.content).trim();
      }
    }

    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (record.role === "assistant" && typeof record.content === "string") {
        return String(record.content).trim();
      }
    }
  } catch {
    // Keep original text when payload is not JSON.
  }

  return trimmed;
}

type LocationBranchRow = {
  name: string | null;
  address: string | null;
  mapsUrl: string | null;
};

function toFirstUrl(value: string | null | undefined): string | null {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  const match = normalized.match(/https?:\/\/[^\s)]+/i);
  return match ? match[0] : null;
}

function cleanLocationTextValue(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeHtmlToPlainText(String(value || ""))
    .replace(/\r/g, "\n")
    .replace(/\[(.*?)\]\((https?:\/\/[^\s)]+)\)/gi, "$1 $2")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized : null;
}

function readRecordStringByKeys(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const normalized = cleanLocationTextValue(value);
    if (normalized) return normalized;
  }
  return null;
}

function parseLocationBranchRowsFromUnknown(
  value: unknown,
  depth = 0,
): LocationBranchRow[] {
  if (depth > 8 || value === null || value === undefined) return [];

  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      parseLocationBranchRowsFromUnknown(item, depth + 1),
    );
  }

  if (typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  const name = readRecordStringByKeys(record, [
    "name",
    "branch_name",
    "branch",
    "cabang",
    "title",
    "clinic_name",
    "outlet_name",
    "office_name",
  ]);
  const address = readRecordStringByKeys(record, [
    "address",
    "alamat",
    "full_address",
    "branch_address",
    "location_address",
    "street",
  ]);
  const mapsRaw = readRecordStringByKeys(record, [
    "maps",
    "maps_url",
    "map",
    "map_url",
    "google_maps",
    "google_maps_url",
    "gmap",
    "link",
    "url",
  ]);
  const mapsUrl = toFirstUrl(mapsRaw) || mapsRaw;

  const hasLocationShape =
    Boolean(name || address || mapsUrl) &&
    (Boolean(name && /clinic|sozo|branch|cabang/i.test(name)) ||
      Boolean(
        address &&
        /jalan|jl\.|kec\.|kel\.|kab\.|kota|kecamatan|kabupaten/i.test(address),
      ) ||
      Boolean(mapsUrl && /^https?:\/\//i.test(mapsUrl)));

  const nestedRows = Object.values(record).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    return parseLocationBranchRowsFromUnknown(item, depth + 1);
  });

  if (!hasLocationShape) return nestedRows;

  return [
    {
      name,
      address,
      mapsUrl,
    },
    ...nestedRows,
  ];
}

function parseLocationBranchRowsFromText(value: string): LocationBranchRow[] {
  const plainContent = normalizeHtmlToPlainText(value);
  const lines = plainContent
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const rows: LocationBranchRow[] = [];
  let current: LocationBranchRow | null = null;

  const flushCurrent = () => {
    if (!current) return;
    if (!current.name && !current.address && !current.mapsUrl) {
      current = null;
      return;
    }
    rows.push(current);
    current = null;
  };

  for (const line of lines) {
    const normalizedLine = cleanLocationTextValue(line) || "";
    if (!normalizedLine) continue;

    const namedBranchMatch = normalizedLine.match(
      /^(?:cabang|branch)\s*\d*\s*[:\-]\s*(.+)$/i,
    );
    if (namedBranchMatch) {
      const parsedName = cleanLocationTextValue(namedBranchMatch[1]);
      if (!parsedName || !/sozo|clinic/i.test(parsedName)) {
        continue;
      }
      flushCurrent();
      current = {
        name: parsedName,
        address: null,
        mapsUrl: null,
      };
      continue;
    }

    const branchMatch = normalizedLine.match(
      /^(?:\d+[\).:-]?\s*)?(?:\*+)?\s*((?:sozo|branch|cabang)[^:]*?)(?:\*+)?$/i,
    );
    if (branchMatch) {
      const parsedName = cleanLocationTextValue(branchMatch[1]);
      if (!parsedName || !/sozo|clinic/i.test(parsedName)) {
        continue;
      }
      flushCurrent();
      current = {
        name: parsedName,
        address: null,
        mapsUrl: null,
      };
      continue;
    }

    if (!current) continue;

    const addressMatch = normalizedLine.match(
      /^(?:alamat|address)\s*[:\-]\s*(.+)$/i,
    );
    if (addressMatch) {
      current.address = cleanLocationTextValue(addressMatch[1]);
      continue;
    }

    if (/^(?:maps?|google maps?)\s*[:\-]/i.test(normalizedLine)) {
      current.mapsUrl =
        toFirstUrl(normalizedLine) || cleanLocationTextValue(normalizedLine);
      continue;
    }

    const urlFromLine = toFirstUrl(normalizedLine);
    if (urlFromLine && /maps|goo\.gl|google/i.test(normalizedLine)) {
      current.mapsUrl = urlFromLine;
      continue;
    }
  }

  flushCurrent();
  return rows;
}

function dedupeLocationBranchRows(
  rows: LocationBranchRow[],
): LocationBranchRow[] {
  const seen = new Set<string>();
  const deduped: LocationBranchRow[] = [];
  for (const row of rows) {
    const key = [
      String(row.name || "")
        .trim()
        .toLowerCase(),
      String(row.address || "")
        .trim()
        .toLowerCase(),
      String(row.mapsUrl || "")
        .trim()
        .toLowerCase(),
    ].join("|");
    if (!key.replace(/\|/g, "")) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function tokenizeLocationHint(value: string | null): Set<string> {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return new Set();
  return new Set(
    normalized
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  );
}

function scoreLocationBranchRowMatch(
  row: LocationBranchRow,
  locationHintTokens: Set<string>,
): number {
  if (locationHintTokens.size === 0) return 0;
  const haystack = [
    String(row.name || ""),
    String(row.address || ""),
    String(row.mapsUrl || ""),
  ]
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const token of locationHintTokens) {
    if (haystack.includes(token)) score += 1;
  }
  return score;
}

function buildLocationResponseFromRows(args: {
  rows: LocationBranchRow[];
  locationHint: string | null;
}): string | null {
  const dedupedRows = dedupeLocationBranchRows(args.rows).slice(0, 8);
  if (dedupedRows.length === 0) return null;

  const locationPrefix = args.locationHint
    ? `Untuk di ${toDisplayLocationLabel(args.locationHint)}, berikut cabang SOZO yang tersedia:`
    : "Berikut cabang SOZO yang tersedia:";

  const branchBlocks = dedupedRows.map((row, index) => {
    const lines: string[] = [];
    lines.push(`${index + 1}. ${row.name || `SOZO Skin Clinic ${index + 1}`}`);
    if (row.address) lines.push(`Alamat: ${row.address}`);
    if (row.mapsUrl) lines.push(`Maps: ${row.mapsUrl}`);
    return lines.join("\n");
  });

  return [locationPrefix, "", branchBlocks.join("\n\n")].join("\n").trim();
}

function buildLocationResponseFromKnowledge(args: {
  knowledge: KnowledgeContextItem[];
  locationHint: string | null;
}): string | null {
  if (args.knowledge.length === 0) return null;
  const rows: LocationBranchRow[] = [];
  for (const item of args.knowledge) {
    const content = String(item.content || "").trim();
    if (!content) continue;
    rows.push(...parseLocationBranchRowsFromText(content));
    try {
      const parsed = JSON.parse(content) as unknown;
      rows.push(...parseLocationBranchRowsFromUnknown(parsed));
    } catch {
      // Ignore non-JSON knowledge content.
    }
  }
  if (rows.length === 0) return null;

  const locationHintTokens = tokenizeLocationHint(args.locationHint);
  const prioritized = rows
    .map((row, index) => ({
      row,
      index,
      score: scoreLocationBranchRowMatch(row, locationHintTokens),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    });

  const hasMatch = prioritized.some((item) => item.score > 0);
  const filteredRows = (
    hasMatch ? prioritized.filter((item) => item.score > 0) : prioritized
  ).map((item) => item.row);

  return buildLocationResponseFromRows({
    rows: filteredRows,
    locationHint: args.locationHint,
  });
}

function buildLocationResponseFromToolRuns(args: {
  toolRuns: ToolExecutionResult[];
  locationHint: string | null;
}): string | null {
  const successfulLocationRuns = args.toolRuns.filter(
    (item) =>
      item.ok &&
      !item.skipped &&
      Boolean(item.responsePreview) &&
      isLocationToolName(item.toolName),
  );
  if (successfulLocationRuns.length === 0) return null;

  const branchRows: LocationBranchRow[] = [];
  for (const run of successfulLocationRuns) {
    const responseText = String(run.responsePreview || "").trim();
    if (!responseText) continue;
    try {
      const parsed = JSON.parse(responseText) as unknown;
      branchRows.push(...parseLocationBranchRowsFromUnknown(parsed));
      continue;
    } catch {
      branchRows.push(...parseLocationBranchRowsFromText(responseText));
    }
  }

  return buildLocationResponseFromRows({
    rows: branchRows,
    locationHint: args.locationHint,
  });
}

function parseLocationRowsFromToolPreview(
  responsePreview: string,
): LocationBranchRow[] {
  const rows: LocationBranchRow[] = [];
  const normalizedPreview = String(responsePreview || "").trim();
  if (!normalizedPreview) return rows;

  try {
    const parsed = JSON.parse(normalizedPreview) as unknown;
    rows.push(...parseLocationBranchRowsFromUnknown(parsed));
  } catch {
    rows.push(...parseLocationBranchRowsFromText(normalizedPreview));
  }

  return dedupeLocationBranchRows(rows);
}

function buildExecutedToolStatusDetails(args: {
  toolRuns: ToolExecutionResult[];
  locationHint: string | null;
}): string[] {
  const messages: string[] = [];

  for (const run of args.toolRuns) {
    if (!run.ok || run.skipped || !run.responsePreview) continue;
    const toolName = String(run.toolName || "").trim() || "tool";

    if (isLocationToolName(toolName)) {
      const locationRows = parseLocationRowsFromToolPreview(
        run.responsePreview,
      );
      if (locationRows.length > 0) {
        const locationSummary =
          buildLocationResponseFromRows({
            rows: locationRows,
            locationHint: args.locationHint,
          }) || "";
        if (locationSummary) {
          messages.push(
            `Location tool output (${toolName}):\n${truncateText(locationSummary, 1_200)}`,
          );
          continue;
        }
      }
    }

    const normalizedPreview = decodeAssistantPayloadText(
      String(run.responsePreview || ""),
    )
      .replace(/\r/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!normalizedPreview) continue;

    messages.push(
      `Tool output (${toolName}):\n${truncateText(normalizedPreview, 900)}`,
    );
  }

  return messages.slice(0, 3);
}

function shouldAttachAutomaticImage(args: {
  locationIntent: boolean;
  strictFollowupMode?: boolean;
  toolRuns: ToolExecutionResult[];
  message?: string;
  resolvedContent?: string;
}): boolean {
  if (args.strictFollowupMode) return false;
  if (args.locationIntent) return false;
  const hasLocationToolResult = args.toolRuns.some(
    (item) => item.ok && !item.skipped && isLocationToolName(item.toolName),
  );
  if (hasLocationToolResult) return false;

  const messageText = String(args.message || "").toLowerCase();
  const responseText = String(args.resolvedContent || "").toLowerCase();
  const combined = `${messageText}\n${responseText}`;

  const hasPriceOrPromoSignal = hasPriceOrPromoCue(combined);
  const hasSpecificTreatmentCueInMessage =
    /\b(acne laser facial|ipl acne|meso acne|acne peel|rejuran scar|underarm brightening|botox|prp hair|hair grow|biolight hair|hifu|skin booster|body whitening peel|body spot repair|slimming treatment)\b/.test(
      messageText,
    );

  return hasPriceOrPromoSignal || hasSpecificTreatmentCueInMessage;
}

function isWeakHandoffResponse(content: string): boolean {
  const normalized = content.toLowerCase();
  const refusalSignals = [
    "tidak dapat memberikan informasi",
    "tidak bisa memberikan informasi",
    "belum dapat memberikan informasi",
    "akan segera menghubungkan",
    "menghubungkan kakak dengan tim",
    "terima kasih atas kesabaran",
  ];
  return refusalSignals.some((signal) => normalized.includes(signal));
}

function extractGreetingLine(content: string): string | null {
  const lines = content
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const firstLine = lines[0];
  return /^(halo|hai|hi|selamat)/i.test(firstLine) ? firstLine : null;
}

function extractPersonaGreetingFromPrompt(
  prompt: string | null | undefined,
): string | null {
  const normalized = toNullableString(prompt);
  if (!normalized) return null;

  const nameMatch = normalized.match(/^\s*nama\s*:\s*([^\n\r]+)/im);
  const rawName = nameMatch?.[1]?.trim();
  if (!rawName) return null;
  const personaName = rawName.replace(/[^\p{L}\p{N}\s.'-]/gu, "").trim();
  if (!personaName) return null;

  const roleOrgMatch = normalized.match(
    /^\s*role\s*:\s*[^\n\r]*?[–-]\s*([^\n\r]+)/im,
  );
  const roleOrg = roleOrgMatch?.[1]?.trim() || null;

  if (roleOrg) {
    return `Halo Kak🤍 Aku ${personaName} dari ${roleOrg}`;
  }

  return `Halo Kak🤍 Aku ${personaName}`;
}

function extractSequenceTwoVoucherClosingFromPrompt(
  prompt: string | null | undefined,
): string | null {
  const normalized = toNullableString(prompt);
  if (!normalized) return null;
  const source = normalized.replace(/\\"/g, '"');

  const scopedMatch = source.match(
    /FORMAT PENUTUP HANYA UNTUK Sequence ke-2[\s\S]{0,2000}?["“]([\s\S]*?weekend atau weekdays[\s\S]*?\?)[”"]/i,
  );
  const voucherMatch = source.match(
    /((?:oh iya kak[,! ]*)?kakak juga bisa mendapatkan voucher treatment\s*50k[\s\S]{0,700}?weekend atau weekdays[\s\S]{0,120}?\?)/i,
  );
  const directMatch =
    scopedMatch?.[1] ||
    source.match(
      /(Oh iya kak[\s\S]{0,700}?weekend atau weekdays[\s\S]{0,120}?\?)/i,
    )?.[1] ||
    voucherMatch?.[1];
  if (!directMatch) return null;

  const cleaned = directMatch
    .replace(/^\s*["“]/, "")
    .replace(/[”"]\s*$/, "")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned.length > 20 ? cleaned : null;
}

const DEFAULT_SEQUENCE_TWO_VOUCHER_CLOSING = [
  "Oh iya kak, Kakak juga bisa mendapatkan voucher treatment 50K + konsultasi dokter gratis jika kakak booking hari ini 😊",
  "",
  "Kakak mau coba di weekend atau weekdays nih kak?",
].join("\n");

function normalizeSequenceTwoVoucherClosing(value: string): string {
  let normalized = String(value || "")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!normalized) return "";

  const hasVoucher = /voucher treatment\s*50k/i.test(normalized);
  const hasWeekendPrompt = /weekend atau weekdays/i.test(normalized);

  if (hasVoucher && !/^oh iya kak[,! ]/i.test(normalized)) {
    normalized = `Oh iya kak, ${normalized}`;
  }
  if (hasVoucher && !hasWeekendPrompt) {
    normalized = `${normalized}\n\nKakak mau coba di weekend atau weekdays nih kak?`;
  }

  return normalized.trim();
}

function hasSequenceTwoVoucherHint(value: unknown): boolean {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  return (
    /voucher treatment\s*50k/.test(normalized) ||
    /konsultasi dokter gratis/.test(normalized) ||
    /weekend atau weekdays/.test(normalized)
  );
}

function extractSequenceTwoVoucherClosingFromRules(
  rules: Array<Record<string, unknown>>,
): string | null {
  for (const rule of rules) {
    const prompt = toNullableString(rule.prompt);
    if (!prompt) continue;
    const extracted = extractSequenceTwoVoucherClosingFromPrompt(prompt);
    if (extracted) return normalizeSequenceTwoVoucherClosing(extracted);
  }
  return null;
}

function resolveSequenceTwoVoucherClosing(args: {
  behaviorPrompt: string | null | undefined;
  matchedFollowups: Array<Record<string, unknown>>;
  allFollowups: Array<Record<string, unknown>>;
}): string | null {
  const fromBehavior = extractSequenceTwoVoucherClosingFromPrompt(
    args.behaviorPrompt,
  );
  if (fromBehavior) {
    return normalizeSequenceTwoVoucherClosing(fromBehavior);
  }

  const fromMatchedRules = extractSequenceTwoVoucherClosingFromRules(
    args.matchedFollowups,
  );
  if (fromMatchedRules) {
    return fromMatchedRules;
  }

  const fromAllRules = extractSequenceTwoVoucherClosingFromRules(
    args.allFollowups,
  );
  if (fromAllRules) {
    return fromAllRules;
  }

  const hasAnyHint = [
    args.behaviorPrompt,
    ...args.matchedFollowups.map((rule) => rule.prompt),
    ...args.allFollowups.map((rule) => rule.prompt),
  ].some((value) => hasSequenceTwoVoucherHint(value));
  if (!hasAnyHint) return null;

  return DEFAULT_SEQUENCE_TWO_VOUCHER_CLOSING;
}

function selectPromoContextSnippet(
  knowledge: KnowledgeContextItem[],
  toolRuns: ToolExecutionResult[],
): string | null {
  const promoParagraphFrom = (value: string): string | null => {
    const normalized = value.replace(/\r/g, "\n").trim();
    if (!normalized) return null;
    const candidates = normalized
      .split(/\n{2,}|###/)
      .map((item) => item.trim())
      .filter(Boolean);

    const preferred = candidates.find((item) => {
      if (isAgentBehaviorPromptText(item)) return false;
      return /promo|harga|price|paket|diskon|flash sale|treatment|intimate glow|cabang|alamat|maps|booking|voucher|konsultasi/i.test(
        item,
      );
    });

    if (preferred) return truncateText(preferred, 550);
    if (isAgentBehaviorPromptText(normalized)) return null;
    return truncateText(normalized, 450);
  };

  const successfulToolPreview = toolRuns
    .filter((item) => item.ok && item.responsePreview)
    .map((item) =>
      decodeAssistantPayloadText(String(item.responsePreview || "").trim()),
    )
    .map((item) => promoParagraphFrom(item))
    .find((preview) => {
      if (!preview) return false;
      return (
        isPromoInfoIntent(preview) ||
        /harga|promo|cabang|alamat|maps/i.test(preview)
      );
    });
  if (successfulToolPreview) {
    return successfulToolPreview;
  }

  const bestKnowledge = knowledge.find((item) => {
    const haystack = `${item.title} ${item.content}`.toLowerCase();
    if (isAgentBehaviorPromptText(haystack)) return false;
    return (
      isPromoInfoIntent(haystack) ||
      /harga|promo|cabang|alamat|maps/.test(haystack)
    );
  });
  if (bestKnowledge) {
    return promoParagraphFrom(bestKnowledge.content);
  }

  return null;
}

function buildPromoFirstResponse(args: {
  chatbot: ChatbotSnapshot;
  message: string;
  knowledge: KnowledgeContextItem[];
  toolRuns: ToolExecutionResult[];
  preferredOpening?: string | null;
}): string {
  const opening =
    toNullableString(args.preferredOpening) ||
    args.chatbot.welcome_msg ||
    extractPersonaGreetingFromPrompt(args.chatbot.prompt) ||
    `Halo, saya ${args.chatbot.name}.`;
  const messageLower = args.message.toLowerCase();
  const intimateGlowTemplate = [
    "Intimate Glow adalah perawatan yang menggabungkan Hair Removal Brazilian VI (1x) dan Intimate Peeling (1x), untuk membantu mengangkat sel kulit mati, mencerahkan area sensitif, serta menghaluskan tekstur kulit.",
    "Berikut detail harganya ya Kak.",
  ].join("\n\n");
  const snippet = messageLower.includes("intimate glow")
    ? intimateGlowTemplate
    : selectPromoContextSnippet(args.knowledge, args.toolRuns) ||
      "Saya bisa bantu jelaskan detail promo dan treatment yang sedang berjalan saat ini.";

  return [
    opening,
    snippet,
    "Kalau boleh tahu, Kakak berdomisili di mana? Nanti saya bantu carikan cabang terdekat untuk Kakak 😊",
  ].join("\n\n");
}

function isServiceCatalogIntent(message: string): boolean {
  const normalized = String(message || "").toLowerCase();
  if (!normalized) return false;

  if (
    /layanan\s+apa\s+saja|treatment\s+apa\s+saja|jenis\s+treatment|kategori\s+layanan|pilihan\s+treatment/.test(
      normalized,
    )
  ) {
    return true;
  }

  return (
    normalized.includes("layanan") &&
    (containsAnyKeyword(normalized, ["apa", "saja", "kategori", "jenis"]) ||
      normalized.includes("treatment"))
  );
}

function hasStructuredServiceCatalog(content: string): boolean {
  const normalized = String(content || "");
  if (!normalized.trim()) return false;
  const hasCategories =
    /(perawatan wajah|perawatan tubuh|perawatan rambut)/i.test(normalized);
  const numericBullets = (normalized.match(/\b\d+\.\s+/g) || []).length;
  const dotBullets = (normalized.match(/(^|\n)\s*[•*-]\s+/g) || []).length;
  const hasEnoughItems = numericBullets >= 4 || dotBullets >= 4;
  const hasConsultativeClosing =
    /concern|keluhan|rekomendasi|yang paling cocok|mau aku bantu/i.test(
      normalized,
    );

  return hasCategories && hasEnoughItems && hasConsultativeClosing;
}

type ServiceCatalogCategory = {
  title: string;
  items: string[];
};

const SERVICE_TREATMENT_CATALOG: Array<{
  name: string;
  category: "Perawatan Wajah" | "Perawatan Tubuh" | "Perawatan Rambut";
  keywords: string[];
}> = [
  {
    name: "Glass Skin Facial",
    category: "Perawatan Wajah",
    keywords: ["glass skin facial"],
  },
  {
    name: "SOZO Signature Facial",
    category: "Perawatan Wajah",
    keywords: ["sozo signature facial"],
  },
  {
    name: "Acne Laser Facial",
    category: "Perawatan Wajah",
    keywords: ["acne laser facial"],
  },
  {
    name: "IPL Acne",
    category: "Perawatan Wajah",
    keywords: ["ipl acne"],
  },
  {
    name: "Meso Acne",
    category: "Perawatan Wajah",
    keywords: ["meso acne"],
  },
  {
    name: "Skin Booster",
    category: "Perawatan Wajah",
    keywords: ["skin booster"],
  },
  {
    name: "HIFU",
    category: "Perawatan Wajah",
    keywords: ["hifu"],
  },
  {
    name: "Body Whitening Peel",
    category: "Perawatan Tubuh",
    keywords: ["body whitening peel"],
  },
  {
    name: "Body Spot Repair",
    category: "Perawatan Tubuh",
    keywords: ["body spot repair"],
  },
  {
    name: "Slimming Treatment",
    category: "Perawatan Tubuh",
    keywords: ["slimming"],
  },
  {
    name: "PRP Hair",
    category: "Perawatan Rambut",
    keywords: ["prp hair"],
  },
  {
    name: "Hair Grow",
    category: "Perawatan Rambut",
    keywords: ["hair grow"],
  },
  {
    name: "Biolight Hair",
    category: "Perawatan Rambut",
    keywords: ["biolight hair"],
  },
];

function buildServiceCatalogCategories(
  knowledgeSources: Array<{ title: string | null; content: string | null }>,
): ServiceCatalogCategory[] {
  const corpus = knowledgeSources
    .map((source) =>
      stripHtml(`${source.title || ""}\n${source.content || ""}`),
    )
    .join("\n")
    .toLowerCase();

  const byCategory = new Map<string, string[]>();
  for (const item of SERVICE_TREATMENT_CATALOG) {
    const matched = item.keywords.some((keyword) => corpus.includes(keyword));
    if (!matched) continue;
    const list = byCategory.get(item.category) || [];
    if (!list.includes(item.name)) list.push(item.name);
    byCategory.set(item.category, list);
  }

  const fallback: ServiceCatalogCategory[] = [
    {
      title: "Perawatan Wajah",
      items: ["Facial", "Acne Laser Facial", "IPL Acne", "Skin Booster"],
    },
    {
      title: "Perawatan Tubuh",
      items: ["Body Spot Repair", "Body Whitening Peel", "Slimming Treatment"],
    },
    {
      title: "Perawatan Rambut",
      items: ["PRP Hair", "Hair Grow", "Biolight Hair"],
    },
  ];

  if (byCategory.size === 0) return fallback;

  const categories: ServiceCatalogCategory[] = [];
  for (const item of fallback) {
    const found = byCategory.get(item.title);
    if (!found || found.length === 0) {
      categories.push(item);
      continue;
    }
    categories.push({
      title: item.title,
      items: found.slice(0, 6),
    });
  }
  return categories;
}

function buildServiceCatalogResponse(args: {
  chatbot: ChatbotSnapshot;
  knowledgeSources: Array<{ title: string | null; content: string | null }>;
}): string {
  const opening =
    extractPersonaGreetingFromPrompt(args.chatbot.prompt) ||
    args.chatbot.welcome_msg ||
    `Halo Kak😊 Aku ${args.chatbot.name}.`;

  const categories = buildServiceCatalogCategories(args.knowledgeSources);
  const itemDescriptions: Record<string, string> = {
    "Glass Skin Facial":
      "Facial untuk membantu kulit tampak lebih bersih dan glowing.",
    "SOZO Signature Facial":
      "Facial signature untuk membersihkan sekaligus menyegarkan wajah.",
    "Acne Laser Facial":
      "Perawatan laser untuk jerawat aktif dan bekas jerawat.",
    "IPL Acne":
      "Perawatan cahaya untuk membantu mengurangi jerawat dan kemerahan.",
    "Meso Acne":
      "Mesoterapi untuk kulit berjerawat dan produksi minyak berlebih.",
    "Skin Booster":
      "Booster untuk hidrasi kulit dan membantu kulit tampak lebih kenyal.",
    HIFU: "Treatment non-invasif untuk membantu mengencangkan area wajah.",
    "Body Spot Repair":
      "Perawatan tubuh untuk membantu area kulit belang/gelap.",
    "Body Whitening Peel":
      "Peeling tubuh untuk membantu mencerahkan tampilan kulit.",
    "Slimming Treatment": "Program body contouring/slimming sesuai kebutuhan.",
    "PRP Hair":
      "Perawatan untuk membantu mengurangi rambut rontok dan menstimulasi pertumbuhan rambut.",
    "Hair Grow":
      "Treatment stimulasi pertumbuhan rambut dengan evaluasi dokter.",
    "Biolight Hair":
      "Perawatan cahaya untuk kesehatan kulit kepala dan rambut.",
  };
  const genericCategoryDescription: Record<string, string> = {
    "Perawatan Wajah": "Perawatan wajah sesuai concern kulit.",
    "Perawatan Tubuh":
      "Perawatan tubuh untuk pencerahan dan perawatan area spesifik.",
    "Perawatan Rambut": "Perawatan rambut dan kulit kepala.",
  };
  const sections = categories.map((category) => {
    const lines = category.items.slice(0, 6).map((item) => {
      const description =
        itemDescriptions[item] ||
        genericCategoryDescription[category.title] ||
        "Perawatan sesuai kebutuhan.";
      return `• **${item}**: ${description}`;
    });
    return `${category.title}\n${lines.join("\n")}`;
  });

  return [
    opening,
    "Kami menyediakan berbagai layanan perawatan kulit dan kecantikan yang bisa disesuaikan dengan kebutuhan Kakak.",
    "Berikut beberapa kategori layanan utama kami:",
    sections.join("\n\n"),
    "Kalau boleh tahu concern utama Kakak saat ini apa ya (misalnya jerawat, kusam, flek, atau rambut rontok)? Nanti aku bantu rekomendasikan treatment yang paling cocok 😊",
  ].join("\n\n");
}

export abstract class ChatbotSimulationService {
  static async simulateResponse(
    input: SimulateChatbotResponseInput,
  ): Promise<SimulateChatbotResponseResult> {
    const trimmedMessage = String(input.message || "").trim();
    if (!trimmedMessage) {
      throw new Error("Message is required");
    }

    const historyLimit = clampNumber(
      input.chatbot.history_limit,
      15,
      1,
      AI_AGENT_HISTORY_LIMIT_MAX,
    );
    const contextLimit = clampNumber(
      input.chatbot.context_limit,
      6,
      1,
      AI_AGENT_CONTEXT_LIMIT_MAX,
    );
    const maxSourceReadWindow = clampNumber(
      input.chatbot.max_file_read_window,
      3,
      1,
      AI_AGENT_READ_FILE_LIMIT_MAX,
    );
    // message_limit is "max AI replies per conversation", not message character length.
    const maxReplyChars = AI_REPLY_CHAR_LIMIT_DEFAULT;
    const strictFollowupMode = input.strictFollowup === true;

    let history = normalizeHistory(input.history, historyLimit);
    if (toBooleanFlag(input.chatbot.session_only_memory, false)) {
      history = [];
    }
    const retrievalMessage = trimmedMessage;
    const retrievalStartedAt = Date.now();
    const messageKeywords = tokenize(retrievalMessage);
    const phraseHints = extractPhraseHints(retrievalMessage);
    const retrievalIntent = resolveRetrievalIntent({
      message: retrievalMessage,
      history,
      strictFollowupMode,
    });
    const retrievalProfile = resolveRetrievalProfile(retrievalIntent);
    const conversationLocation = strictFollowupMode
      ? null
      : resolveConversationLocation({
          message: trimmedMessage,
          history,
        });
    const knowledgeSnapshotAt = new Date().toISOString();
    const runtime = await resolveProviderRuntime({
      appId: input.appId,
      chatbot: input.chatbot,
    });

    const [{ knowledgeSources, faqs }, evaluations] = (input.skipRag || input.minimalContext)
      ? [{ knowledgeSources: [], faqs: [] }, []]
      : await Promise.all([
          fetchKnowledgeCatalog({
            appId: input.chatbot.app_id,
            chatbotId: input.chatbot.id,
            allowAllKnowledge: input.allowAllKnowledge === true,
          }),
      prisma.ai_evaluations.findMany({
        where: {
          app_id: input.chatbot.app_id,
          chatbot_id: input.chatbot.id,
          deleted_at: null,
        },
        orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
        take: 200,
        select: {
          id: true,
          type: true,
          content: true,
          metadata: true,
          created_at: true,
        },
      }),
    ]);
    const embeddingVector = (input.skipRag || input.minimalContext || !retrievalMessage) ? null : await resolveEmbeddingVector({
      appId: input.appId,
      runtime,
      message: retrievalMessage,
    });
    const vectorScoreByKnowledge = embeddingVector
      ? await resolveVectorScores({
          appId: input.chatbot.app_id,
          chatbotId: input.chatbot.id,
          vector: embeddingVector,
          allowAllKnowledge: input.allowAllKnowledge === true,
        })
      : new Map<string, number>();
    const maxSourceChars = maxSourceReadWindow * 800;

    const rankedFaqs: KnowledgeContextItem[] = faqs.map((faq) => {
      const content = `${faq.question || ""}\n${faq.answer || ""}`.trim();
      const plainContent = stripHtml(content);
      const keywordScore = scoreByKeywordOverlap(messageKeywords, plainContent);
      const vectorScore = vectorScoreByKnowledge.get(`faq:${faq.id}`) || 0;
      return {
        type: "faq",
        id: faq.id,
        title: faq.question || "FAQ",
        content: extractRelevantKnowledgeWindow(
          plainContent,
          messageKeywords,
          maxSourceChars,
          phraseHints,
        ),
        keywordScore,
        vectorScore,
        score:
          keywordScore * retrievalProfile.keywordBoost +
          vectorScore * retrievalProfile.vectorBoost +
          Number(faq.priority || 0),
      };
    });

    const rankedSources: KnowledgeContextItem[] = knowledgeSources.map(
      (source) => {
        const content = stripHtml(String(source.content || ""));
        const baseText = `${source.title || ""}\n${content}`.trim();
        const keywordScore = scoreByKeywordOverlap(messageKeywords, baseText);
        const vectorScore =
          vectorScoreByKnowledge.get(`source:${source.id}`) || 0;
        return {
          type: "source",
          id: source.id,
          title: source.title || source.type || "Knowledge Source",
          content: extractRelevantKnowledgeWindow(
            baseText,
            messageKeywords,
            maxSourceChars,
            phraseHints,
          ),
          keywordScore,
          vectorScore,
          score:
            keywordScore * retrievalProfile.keywordBoost +
            vectorScore * retrievalProfile.vectorBoost,
        };
      },
    );

    const rankedKnowledge = [...rankedFaqs, ...rankedSources]
      .filter(
        (item) =>
          item.content.length > 0 && !isAgentBehaviorKnowledgeItem(item),
      )
      .sort((a, b) => b.score - a.score);

    const relevanceFilteredKnowledge = filterKnowledgeByRelevance(
      rankedKnowledge,
      {
        minTotalScore: retrievalProfile.minTotalScore,
        minKeywordOverlap: retrievalProfile.minKeywordOverlap,
        minVectorSimilarity: retrievalProfile.minVectorSimilarity,
      },
    );
    const candidateKnowledge = prioritizeKnowledgeForAccuracy({
      items: relevanceFilteredKnowledge,
      intent: retrievalIntent,
      message: retrievalMessage,
      history,
      messageKeywords,
    });
    const compressedKnowledge = compressKnowledgeWithRTK({
      items: candidateKnowledge,
      contextLimit:
        input.mode === "live"
          ? Math.max(
              6,
              Math.min(retrievalProfile.liveContextItemCap, contextLimit * 2),
            )
          : contextLimit,
      mode: input.mode,
      liveCharBudget: retrievalProfile.liveCharBudget,
      liveMaxItemChars: retrievalProfile.liveMaxItemChars,
    });
    let selectedKnowledge = compressedKnowledge.items;
    const retrievalLatencyMs = Math.max(1, Date.now() - retrievalStartedAt);
    const rtkSummary: RtkSummaryLog = {
      ...compressedKnowledge.summary,
      after_count: selectedKnowledge.length,
    };
    const knowledgeReferences = serializeKnowledgeReferences(selectedKnowledge);

    const followups = normalizeFollowups(input.chatbot.ai_followups);
    const matchedFollowups = followups.filter((rule) => {
      const prompt = toNullableString(rule.prompt);
      if (!prompt) return false;
      return scoreByKeywordOverlap(messageKeywords, prompt) > 0;
    });
    const pluginData = toRecord(input.chatbot.plugin_data);
    const activeConfiguredToolNames = toRecordArray(pluginData?.ai_tools)
      .filter((card) => toBooleanFlag(card.is_active, false))
      .map((card) => toNullableString(card.name))
      .filter((value): value is string => Boolean(value));
    const locationIntent = strictFollowupMode
      ? false
      : inferLocationIntent({
          message: trimmedMessage,
        });

    let toolRuns: ToolExecutionResult[] = [];
    let availableTools: APIToolRecord[] = [];
    let candidateTools: APIToolRecord[] = [];
    const shouldRunTools = input.runTools !== false && !strictFollowupMode && !input.minimalContext;
    if (shouldRunTools) {
      availableTools = await APIToolsService.listToolsReadOnly(
        input.chatbot.app_id,
      );
      candidateTools = resolveCandidateTools({
        availableTools,
        configuredCardsRaw: pluginData?.ai_tools,
      });

      const scoredTools = candidateTools
        .map((tool) => {
          const scored = scoreToolRelevance({
            tool,
            message: trimmedMessage,
            messageKeywords,
            history,
            locationIntent,
          });
          return {
            tool,
            relevance: scored.relevance,
            isLocationCandidate: scored.isLocationCandidate,
          };
        })
        .sort((a, b) => b.relevance - a.relevance);
      const toolsToExecute = (() => {
        const relevantTools = scoredTools
          .filter(
            (item) =>
              item.relevance > 0 &&
              (locationIntent || !item.isLocationCandidate),
          )
          .slice(0, MAX_SIMULATED_TOOL_CALLS);
        if (relevantTools.length > 0) return relevantTools;

        return [];
      })();

      if (toolsToExecute.length > 0) {
        toolRuns = await Promise.all(
          toolsToExecute.map((item) =>
            executeApiTool({
              tool: item.tool,
              message: trimmedMessage,
              history,
              locationHint: conversationLocation,
            }),
          ),
        );
      }
    }

    const configuredLabelIds = toStringArray(input.chatbot.selected_labels);
    let appliedLabelName: string | null = null;
    let appliedLabelId: string | null = null;

    if (configuredLabelIds.length > 0) {
      const labels = await prisma.labels.findMany({
        where: {
          app_id: input.chatbot.app_id,
          id: { in: configuredLabelIds },
          deleted_at: null,
        },
        select: {
          id: true,
          title: true,
        },
      });

      if (labels.length > 0) {
        const configuredLabels: ConfiguredLabelCandidate[] = labels
          .map((label) => ({
            id: label.id,
            title: toNullableString(label.title) || "",
          }))
          .filter((item) => item.title.length > 0);
        const dynamicLabelDecision = resolveDynamicAppliedLabel({
          message: trimmedMessage,
          history,
          labelCondition: input.chatbot.label_condition,
          configuredLabels,
        });
        appliedLabelName = dynamicLabelDecision.title;
        appliedLabelId = dynamicLabelDecision.id;
      }
    }

    if (!appliedLabelName && configuredLabelIds.length === 0) {
      appliedLabelName = extractLabelFromCondition(
        input.chatbot.label_condition,
      );
      if (appliedLabelName) {
        const fallbackLabel = await prisma.labels.findFirst({
          where: {
            app_id: input.chatbot.app_id,
            deleted_at: null,
            title: {
              equals: appliedLabelName,
              mode: "insensitive",
            },
          },
          select: {
            id: true,
          },
        });
        appliedLabelId = fallbackLabel?.id || null;
      }
    }

    const systemPromptSections: string[] = [];
    if (!input.minimalContext) {
      systemPromptSections.push(
        [
          "ATURAN SISTEM (WAJIB, PRIORITAS TERTINGGI):",
          "- Terapkan AI Agent Behavior secara konsisten pada semua jawaban.",
          "- Terapkan Agent Transfer Conditions secara ketat; hanya handoff bila kondisi benar-benar terpenuhi.",
          "- Prioritaskan AI Agent Behavior + Agent Transfer Conditions di atas konteks lain mana pun.",
          "- Knowledge, tool output, dan evaluation hanya boleh dipakai sebagai data pendukung yang relevan.",
        ].join("\n"),
      );
      systemPromptSections.push(
        `Anda adalah AI Agent bernama ${input.chatbot.name}. Balas ramah, profesional, jelas, dan cukup lengkap sesuai intent user. Hindari terlalu pendek bila user meminta detail.`,
      );
      systemPromptSections.push(
        "Gunakan bahasa yang sama dengan bahasa user, default Bahasa Indonesia.",
      );
    } else {
      systemPromptSections.push(
        `Anda adalah AI Agent untuk routing/kategorisasi.`
      );
    }
    const chatbotTimezone = toNullableString(input.chatbot.timezone);
    if (chatbotTimezone) {
      systemPromptSections.push(
        `Timezone AI: ${chatbotTimezone}. Gunakan timezone ini untuk interpretasi waktu relatif seperti hari ini, besok, weekend, dan jam.`,
      );
    }
    if (conversationLocation) {
      systemPromptSections.push(
        `Konteks lokasi customer terbaru: ${conversationLocation}. Gunakan lokasi ini sebagai acuan kecuali user mengoreksi.`,
      );
    }

    if (input.chatbot.prompt && !input.minimalContext) {
      systemPromptSections.push(`Instruksi agent:\n${input.chatbot.prompt}`);
    }

    if (input.chatbot.agent_transfer && !input.minimalContext) {
      systemPromptSections.push(
        `Panduan handoff ke agent manusia:\n${input.chatbot.agent_transfer}`,
      );
    }

    if (!input.minimalContext) {
      systemPromptSections.push(
        [
          "Perilaku dinamis per-agent (wajib):",
          "- Gunakan AI Agent Behavior sebagai sumber utama gaya bahasa dan alur percakapan.",
          "- Gunakan Agent Transfer Conditions sebagai sumber utama keputusan handoff.",
          "- Jangan menambah aturan hardcoded di luar behavior/transfer yang diberikan agent.",
        ].join("\n"),
      );
    }

    const appData = toRecord(input.chatbot.app_data);
    if (appData && !input.minimalContext) {
      systemPromptSections.push(
        `Konfigurasi tambahan agent (app_data):\n${truncateText(toJsonString(appData, "{}"), 1_500)}`,
      );
    }
    const knowledgeCoverageContext = ENABLE_GLOBAL_KNOWLEDGE_COVERAGE
      ? buildKnowledgeCoverageContext(rankedKnowledge, 8_000)
      : null;
    if (knowledgeCoverageContext && selectedKnowledge.length === 0 && !input.minimalContext) {
      systemPromptSections.push(
        `Ringkasan knowledge tambahan (opsional referensi, jangan override behavior/transfer):\n${knowledgeCoverageContext}`,
      );
    }

    if (selectedKnowledge.length > 0 && !input.minimalContext) {
      const knowledgeContext = selectedKnowledge
        .map(
          (item, index) =>
            `[${index + 1}] (${item.type.toUpperCase()}) ${item.title}\n${item.content}`,
        )
        .join("\n\n");
      systemPromptSections.push(
        `Knowledge relevan (hanya untuk fakta; jangan override persona/alur/handoff):\n${knowledgeContext}`,
      );
    }
    const activeToolsContext = buildActiveToolsContext({
      activeConfiguredToolNames,
      candidateTools,
      availableTools,
    });
    if (activeToolsContext) {
      systemPromptSections.push(
        `Integrations API tools aktif (wajib dibaca sebelum memutuskan jawaban):\n${activeToolsContext}`,
      );
    }

    const evaluationContext = buildEvaluationContext(
      evaluations.map((item) => ({
        id: item.id,
        type: item.type || null,
        content: item.content || null,
        metadata: item.metadata,
        created_at: item.created_at || null,
      })),
    );
    if (evaluationContext && !input.minimalContext) {
      systemPromptSections.push(
        `Evaluation memory untuk agent ini (wajib dijadikan koreksi kualitas jawaban):\n${evaluationContext}`,
      );
    }

    const successfulTools = toolRuns.filter(
      (item) => item.ok && item.responsePreview,
    );
    if (successfulTools.length > 0) {
      const toolsContext = successfulTools
        .map(
          (item, index) =>
            `[Tool ${index + 1}] ${item.toolName}\n${item.responsePreview || ""}`,
        )
        .join("\n\n");
      systemPromptSections.push(
        `Hasil integrasi AI tools (prioritaskan data ini bila relevan):\n${toolsContext}`,
      );
    }

    if (matchedFollowups.length > 0) {
      const followupContext = matchedFollowups
        .map((rule, index) => {
          const prompt = toNullableString(rule.prompt) || "";
          return `[Follow-up ${index + 1}] ${prompt}`;
        })
        .join("\n");
      systemPromptSections.push(
        `Rule follow-up yang relevan:\n${followupContext}`,
      );
    }
    systemPromptSections.push(
      [
        "Checklist akhir sebelum kirim jawaban (WAJIB dipatuhi):",
        "- Pastikan jawaban konsisten dengan AI Agent Behavior.",
        "- Pastikan keputusan handoff hanya mengikuti Agent Transfer Conditions.",
        "- Jika konteks knowledge/tool/evaluation bertentangan dengan behavior atau transfer conditions, prioritaskan behavior + transfer conditions.",
      ].join("\n"),
    );

    const systemPrompt = systemPromptSections.join("\n\n");
    const runtimeForRequest =
      input.entrypoint === "flow_runtime"
        ? {
            ...runtime,
            maxTokens: Math.max(runtime.maxTokens, 4_096),
          }
        : runtime;
    const modelResponse = await requestModelResponse({
      runtime: runtimeForRequest,
      systemPrompt,
      history,
      message: trimmedMessage,
    });

    const fallbackResponse = buildFallbackResponse({
      chatbot: input.chatbot,
      message: trimmedMessage,
      knowledge: selectedKnowledge,
      toolRuns,
      history,
    });
    const hasModelContent = Boolean(
      modelResponse.content && modelResponse.content.trim(),
    );
    let fallbackReason: string | null = null;
    if (!hasModelContent) {
      fallbackReason = modelResponse.trace.hit
        ? "empty_provider_content"
        : modelResponse.trace.error
          ? "provider_error"
          : "provider_unavailable";
    }

    let resolvedContent =
      (modelResponse.content && modelResponse.content.trim()) ||
      fallbackResponse;

    const sanitizedResolvedContent =
      sanitizeAssistantResponseForDelivery(resolvedContent);
    if (sanitizedResolvedContent) {
      resolvedContent = sanitizedResolvedContent;
    } else {
      const sanitizedFallback =
        sanitizeAssistantResponseForDelivery(fallbackResponse);
      resolvedContent =
        sanitizedFallback ||
        `Halo, saya ${input.chatbot.name}. Boleh ceritakan kebutuhan Kakak agar saya bisa bantu dengan tepat?`;
      if (!fallbackReason) {
        fallbackReason = "sanitized_empty_content";
      }
    }
    if (ENABLE_STRICT_TREATMENT_PRICE_FORMATTER) {
      resolvedContent = applyStrictTreatmentPriceFormatter({
        message: trimmedMessage,
        history,
        currentContent: resolvedContent,
        knowledgeSources,
      });
    }
    if (ENABLE_INLINE_IMAGE_TARGET_NORMALIZER) {
      resolvedContent = normalizeInlineImageTargetsForResponse({
        content: resolvedContent,
        message: trimmedMessage,
        history,
        selectedKnowledge,
        toolRuns,
      });
    }

    const disableReplyTruncationForAccuracy =
      input.entrypoint === "flow_runtime";
    const effectiveMaxReplyChars = resolveAdaptiveReplyCharLimit({
      message: trimmedMessage,
      baseLimit: disableReplyTruncationForAccuracy
        ? 12_000
        : maxReplyChars,
      locationResponseWithFallback: false,
    });
    const truncatedContent = disableReplyTruncationForAccuracy
      ? resolvedContent.trim()
      : truncateText(resolvedContent.trim(), effectiveMaxReplyChars);
    const resolvedModelName =
      runtime.modelName || input.chatbot.model || "standard";

    const rawCreditsUsed = await AIService.calculateCreditCost(
      resolvedModelName,
    ).catch(() => 1);
    const fallbackCredits =
      MODEL_CREDIT_FALLBACK[normalizeToolLookupKey(resolvedModelName)] ?? 9;
    const pricedCredits = roundCreditAmount(rawCreditsUsed);
    const creditsUsed =
      pricedCredits > 0 ? pricedCredits : roundCreditAmount(fallbackCredits);
    const providerTrace = {
      provider: runtime.provider,
      endpoint: modelResponse.trace.endpoint,
      status_code: modelResponse.trace.status_code,
      hit: modelResponse.trace.hit,
      used_fallback: Boolean(fallbackReason),
      fallback_reason: fallbackReason,
      error: modelResponse.trace.error,
    };
    rtkSummary.provider_trace = providerTrace;

    const timeline: SimulationPreviewTimelineItem[] = [];
    const executedToolsCount = toolRuns.filter((item) => !item.skipped).length;
    const succeededToolsCount = toolRuns.filter((item) => item.ok).length;

    if (shouldRunTools && executedToolsCount > 0) {
      timeline.push({
        type: "status",
        text:
          succeededToolsCount > 0
            ? "Successfully executed tool calls"
            : "Tool calls failed, using fallback response",
      });
    }
    if (shouldRunTools && succeededToolsCount > 0) {
      const toolStatusDetails = buildExecutedToolStatusDetails({
        toolRuns,
        locationHint: conversationLocation,
      });
      for (const statusText of toolStatusDetails) {
        timeline.push({
          type: "status",
          text: statusText,
        });
      }
    }
    timeline.push({
      type: "status",
      text: providerTrace.hit
        ? fallbackReason
          ? `AI provider hit (${providerTrace.provider || "unknown"}), lalu fallback (${fallbackReason}).`
          : `AI provider hit (${providerTrace.provider || "unknown"}).`
        : `AI provider fallback (${providerTrace.provider || "unknown"}): ${providerTrace.error || fallbackReason || "provider_unavailable"}.`,
    });

    if (appliedLabelName) {
      timeline.push({
        type: "status",
        text: `Successfully labeled conversation with: ${appliedLabelName}`,
      });
    }

    const inlineSegments = splitInlineContentSegments(truncatedContent);
    const hasInlineImages = inlineSegments.some(
      (segment) => segment.type === "image",
    );
    let displayContent = stripInlineImageTokensFromText(truncatedContent);

    if (hasInlineImages) {
      const textParts: string[] = [];
      for (const segment of inlineSegments) {
        if (segment.type === "text") {
          textParts.push(segment.content);
          const blocks = splitResponseIntoPreviewBlocks(segment.content);
          for (const block of blocks) {
            timeline.push({
              type: "text",
              role: "assistant",
              content: block,
            });
          }
          continue;
        }

        timeline.push({
          type: "image",
          role: "assistant",
          url: segment.url,
          alt: "Promo image",
        });
      }
      displayContent = textParts.join("\n\n").trim() || displayContent;
    } else {
      const responseBlocks = splitResponseIntoPreviewBlocks(displayContent);
      for (const block of responseBlocks) {
        timeline.push({
          type: "text",
          role: "assistant",
          content: block,
        });
      }

      if (responseBlocks.length === 0 && displayContent) {
        timeline.push({
          type: "text",
          role: "assistant",
          content: displayContent,
        });
      }
    }

    const finalContent = displayContent || truncatedContent;
    const completionTokens = Math.max(
      modelResponse.usage.completion_tokens,
      estimateTokensFromText(finalContent),
    );
    const totalTokens = Math.max(
      modelResponse.usage.total_tokens,
      modelResponse.usage.prompt_tokens + completionTokens,
    );
    const usageStats: UsageStats = {
      prompt_tokens: modelResponse.usage.prompt_tokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
    };
    const usageCost = mapUsageCostFromTokens(usageStats.total_tokens);
    const logResult = await AIResponseLogService.create({
      appId: input.chatbot.app_id,
      chatbotId: input.chatbot.id,
      conversationId: input.conversationId || null,
      entrypoint:
        input.entrypoint ||
        (input.mode === "live" ? "webhook_live" : "simulate"),
      provider: runtime.provider,
      modelName: resolvedModelName,
      promptTokens: usageStats.prompt_tokens,
      completionTokens: usageStats.completion_tokens,
      totalTokens: usageStats.total_tokens,
      usageCredits: usageCost.credits,
      usageUsd: usageCost.usd,
      usageIdr: usageCost.idr,
      billedCredits: creditsUsed,
      knowledgeReferences,
      rtkSummary,
      messageIds: input.sourceMessageIds || [],
      knowledgeSnapshotAt,
      status: "generated",
    });
    const aiResponseLogId = logResult.logId || null;
    if (input.mode === "live") {
      try {
        const retrievalTopK = clampNumber(
          selectedKnowledge.length > 0
            ? selectedKnowledge.length
            : contextLimit,
          5,
          1,
          20,
        );
        const retrievalItems = selectedKnowledge.slice(0, retrievalTopK);
        await KnowledgeService.logRetrievalObservation({
          appId: input.chatbot.app_id,
          channel: "live",
          queryText: retrievalMessage,
          topK: retrievalTopK,
          retrievalMs: retrievalLatencyMs,
          thresholdUsed: retrievalProfile.minVectorSimilarity,
          answerText: finalContent,
          promptTokens: usageStats.prompt_tokens,
          completionTokens: usageStats.completion_tokens,
          totalTokens: usageStats.total_tokens,
          usageCredits: usageCost.credits,
          usageUsd: usageCost.usd,
          usageIdr: usageCost.idr,
          chunks: retrievalItems.map((item, index) => ({
            chunkId: null,
            sourceId: item.type === "source" ? toNullableString(item.id) : null,
            rank: index + 1,
            score: Number(Number(item.score || 0).toFixed(6)),
            locatorLabel: item.type === "faq" ? "faq" : `sec.${index + 1}`,
            snippet: String(item.content || "").slice(0, 420),
          })),
        });
      } catch (retrievalLogError) {
        console.warn(
          "[ChatbotSimulationService] Failed to write live retrieval observation",
          {
            appId: input.chatbot.app_id,
            chatbotId: input.chatbot.id,
            retrievalLogError,
          },
        );
      }
    }

    return {
      content: finalContent,
      meta: {
        ai_agent_id: input.chatbot.id,
        ai_agent_name: input.chatbot.name,
        is_ai: true,
        ai_generated: true,
        generated_by_ai: true,
        ai_source: input.chatbot.name,
        provider: runtime.provider,
        ai_provider_hit: providerTrace.hit,
        ai_provider_endpoint: providerTrace.endpoint,
        ai_provider_status_code: providerTrace.status_code,
        ai_provider_error: providerTrace.error,
        ai_fallback_reason: fallbackReason,
        knowledge_hits: selectedKnowledge.length,
        tools_called: toolRuns.filter((item) => !item.skipped).length,
        tools_succeeded: toolRuns.filter((item) => item.ok).length,
        followups_matched: matchedFollowups.length,
        label_applied_id: appliedLabelId,
        label_applied: appliedLabelName,
        credits_used: creditsUsed,
        mode: input.mode,
        ai_response_log_id: aiResponseLogId,
        ai_tokens_prompt: usageStats.prompt_tokens,
        ai_tokens_completion: usageStats.completion_tokens,
        ai_tokens_total: usageStats.total_tokens,
        ai_cost_credits: usageCost.credits,
        ai_cost_usd: usageCost.usd,
        ai_cost_idr: usageCost.idr,
        ai_knowledge_references: knowledgeReferences,
        ai_rtk_summary: rtkSummary,
        knowledge_snapshot_at: knowledgeSnapshotAt,
        rag_intent: retrievalIntent,
        rag_profile: {
          keyword_boost: retrievalProfile.keywordBoost,
          vector_boost: retrievalProfile.vectorBoost,
          min_total_score: retrievalProfile.minTotalScore,
          min_keyword_overlap: retrievalProfile.minKeywordOverlap,
          min_vector_similarity: retrievalProfile.minVectorSimilarity,
          live_context_item_cap: retrievalProfile.liveContextItemCap,
          live_char_budget: retrievalProfile.liveCharBudget,
          live_max_item_chars: retrievalProfile.liveMaxItemChars,
        },
      },
      preview: {
        timeline,
        credits_used: creditsUsed,
      },
    };
  }
}

export const __test__ = {
  toBooleanFlag,
  parseUsageFromProviderPayload,
  estimateUsageFromMessages,
  resolveUsageWithFallback,
  normalizeAgentToolCards,
  resolveCandidateTools,
  isToolExecutionEnabledByLimit,
  compressKnowledgeWithRTK,
  filterKnowledgeByRelevance,
  serializeKnowledgeReferences,
  mapUsageCostFromTokens,
  inferLocationIntent,
  buildLocationResponseFromToolRuns,
  buildLocationResponseFromKnowledge,
  hasMainResponseLeakage,
  sanitizeAssistantResponseForDelivery,
  extractSequenceTwoVoucherClosingFromPrompt,
  normalizeSequenceTwoVoucherClosing,
  resolveSequenceTwoVoucherClosing,
  buildExecutedToolStatusDetails,
  shouldAttachAutomaticImage,
  extractImageCandidates,
  resolveInlineImageUrlForSection,
  resolveMappedImageUrlByKeywords,
  normalizeInlineImageTargetsForResponse,
  buildImageIntentKeywords,
  buildTreatmentPriceCatalog,
  extractTreatmentPriceContext,
  applyStrictTreatmentPriceFormatter,
  buildDeterministicSingleTreatmentPriceResponse,
  deriveImageIntentKeywords,
  scoreImageContextRelevance,
  stripInlineImageTokensFromText,
  splitInlineContentSegments,
  isServiceCatalogIntent,
  hasStructuredServiceCatalog,
  buildServiceCatalogCategories,
  buildServiceCatalogResponse,
};
