import prisma from "../../lib/prisma";
import { resolveAppId } from "../../lib/utils";
import { KnowledgeIndexService } from "./indexing-service";
import { AIService } from "../ai/service";

type RetrievalChannel = "test" | "live";

type SourceFileInput = {
  file_name: string;
  mime_type?: string | null;
  file_size_bytes?: number | null;
  checksum_sha256?: string | null;
  storage_key?: string | null;
  storage_url?: string | null;
  language?: string | null;
  page_count?: number | null;
  duration_ms?: number | null;
  extraction_metadata?: Record<string, unknown> | null;
};

type SourceUpsertInput = {
  title: string;
  content?: string | null;
  type?: string | null;
  format?: string | null;
  embedding_model?: string | null;
  metadata?: Record<string, unknown> | null;
  source_type?: string | null;
  source_url?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  file_type?: string | null;
  category_id?: string | null;
  files?: SourceFileInput[];
};

type KnowledgeChunkCandidate = {
  id: string;
  source_id: string;
  source_title: string;
  chunk_index: number;
  chunk_text: string;
  locator_label: string | null;
  score: number;
};

type RetrievalObservationInput = {
  appId: string;
  channel: RetrievalChannel;
  queryText: string;
  selectedSourceIds?: string[];
  topK: number;
  retrievalMs: number;
  thresholdUsed: number;
  retrievalProvider?: string | null;
  retrievalModelId?: string | null;
  answerText?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  usageCredits?: number;
  usageUsd?: number;
  usageIdr?: number;
  chunks: Array<{
    chunkId?: string | null;
    sourceId?: string | null;
    rank: number;
    score: number;
    locatorLabel?: string | null;
    snippet?: string | null;
  }>;
};

type EmbeddingRuntime = {
  provider: string | null;
  baseUrl: string | null;
  apiKey: string | null;
  apiVersion: string;
  deploymentName: string | null;
  embeddingModelName: string;
};

const DEFAULT_RAG_THRESHOLD = 0.3;
const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 20;
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const SUPPORTED_EMBEDDING_MODELS = new Set([
  "text-embedding-3-small",
  "text-embedding-ada-002",
]);
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isAgentBehaviorPromptKnowledge(
  title: unknown,
  content: unknown,
): boolean {
  return /(ai agent behaviou?r|core identity|tone of voice|objectives|communication style|discovery questions|safety|guard rail|instruksi agent|panduan handoff|role:\s*ai|personality:|strict rules:)/i.test(
    `${String(title || "")}\n${String(content || "")}`,
  );
}

function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

function normalizeNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return numeric;
}

function normalizeEmbeddingModel(value: unknown): string | null {
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized) return null;
  if (!SUPPORTED_EMBEDDING_MODELS.has(normalized)) return null;
  return normalized;
}

function resolveEmbeddingDimension(model: string): number {
  if (model === "text-embedding-3-small") return 1536;
  if (model === "text-embedding-ada-002") return 1536;
  return 1536;
}

function toUuidArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const set = new Set<string>();
  for (const item of value) {
    const candidate = normalizeString(item);
    if (!candidate) continue;
    set.add(candidate);
  }
  return [...set];
}

function toStrictUuidArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const set = new Set<string>();
  for (const item of value) {
    const candidate = normalizeString(item);
    if (!candidate || !isUuid(candidate)) continue;
    set.add(candidate);
  }
  return [...set];
}

function safeJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

function normalizeSourceStatus(value: unknown): string {
  const normalized = normalizeString(value)?.toLowerCase() || "pending";
  if (
    [
      "pending",
      "extracting",
      "chunking",
      "embedding",
      "ready",
      "failed",
      "archived",
    ].includes(normalized)
  ) {
    return normalized;
  }
  if (normalized === "processing") return "embedding";
  if (normalized === "error") return "failed";
  return "pending";
}

function normalizeSourceFormat(
  type: unknown,
  format: unknown,
  fileType: unknown,
): string {
  const direct = normalizeString(format)?.toLowerCase();
  if (direct) return direct;

  const normalizedType = normalizeString(type)?.toLowerCase();
  if (normalizedType) {
    if (
      normalizedType === "website" ||
      normalizedType === "url" ||
      normalizedType === "site"
    ) {
      return "website";
    }
    if (normalizedType === "img") return "image";
    if (normalizedType === "md") return "markdown";
    return normalizedType;
  }

  const mime = normalizeString(fileType)?.toLowerCase() || "";
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("markdown")) return "markdown";
  if (mime.includes("wordprocessingml") || mime.includes("msword"))
    return "docx";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  return "text";
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const fixed =
    size >= 100
      ? size.toFixed(0)
      : size >= 10
        ? size.toFixed(1)
        : size.toFixed(2);
  return `${fixed} ${units[unitIndex]}`;
}

function estimateTokenCount(text: string): number {
  const normalized = String(text || "").trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function normalizeChunkTextForReply(
  value: unknown,
  maxChars: number | null = null,
): string {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";

  let cleaned = normalized;
  if (/^[a-z0-9]/.test(cleaned)) {
    const boundaryMatch = cleaned.match(/[.!?]\s+/);
    if (
      boundaryMatch &&
      typeof boundaryMatch.index === "number" &&
      boundaryMatch.index >= 0 &&
      boundaryMatch.index <= 120
    ) {
      const candidate = cleaned
        .slice(boundaryMatch.index + boundaryMatch[0].length)
        .trim();
      if (candidate) cleaned = candidate;
    }
  }

  if (!Number.isFinite(Number(maxChars)) || Number(maxChars) <= 0) {
    return cleaned;
  }

  const boundedMaxChars = Math.max(100, Math.round(Number(maxChars)));
  if (cleaned.length <= boundedMaxChars) return cleaned;
  const clipped = cleaned
    .slice(0, Math.max(0, boundedMaxChars - 1))
    .trim();
  const lastBoundary = Math.max(
    clipped.lastIndexOf(". "),
    clipped.lastIndexOf("; "),
    clipped.lastIndexOf(", "),
    clipped.lastIndexOf(" "),
  );
  if (lastBoundary >= Math.floor(boundedMaxChars * 0.6)) {
    return `${clipped.slice(0, lastBoundary).trim()}…`;
  }
  return `${clipped}…`;
}

async function resolveEmbeddingRuntime(
  appId: string,
  preferredEmbeddingModel?: string | null,
): Promise<EmbeddingRuntime> {
  const [settings, runtimeProvider] = await Promise.all([
    AIService.getSettings(appId).catch(() => null),
    AIService.getRuntimeProviderConfig("embedding").catch(() => null),
  ]);

  const provider =
    normalizeString(runtimeProvider?.provider) ||
    normalizeString(settings?.model_provider) ||
    normalizeString(process.env.AI_PROVIDER);

  const baseUrl =
    normalizeString(runtimeProvider?.base_url) ||
    normalizeString(settings?.api_endpoint) ||
    normalizeString(process.env.AZURE_OPENAI_ENDPOINT);

  const apiKey =
    normalizeString(runtimeProvider?.api_key) ||
    normalizeString(settings?.api_key) ||
    normalizeString(process.env.AZURE_OPENAI_API_KEY) ||
    normalizeString(process.env.OPENAI_API_KEY);

  const apiVersion =
    normalizeString(runtimeProvider?.api_version) ||
    normalizeString(settings?.api_version) ||
    "2024-02-15-preview";

  const deploymentName =
    normalizeString(runtimeProvider?.deployment_name) ||
    normalizeString(settings?.deployment_name) ||
    normalizeString(process.env.AZURE_OPENAI_DEPLOYMENT);

  const embeddingModelName =
    normalizeEmbeddingModel(preferredEmbeddingModel) ||
    normalizeEmbeddingModel(process.env.AI_EMBEDDING_MODEL) ||
    DEFAULT_EMBEDDING_MODEL;

  return {
    provider,
    baseUrl,
    apiKey,
    apiVersion,
    deploymentName,
    embeddingModelName,
  };
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.replace(/^\/+/, "");
  return `${base}/${suffix}`;
}

function extractEmbedding(payload: unknown): number[] | null {
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

function extractEmbeddingErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return null;
  const error = (payload as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" && code.trim().length > 0 ? code : null;
}

async function requestAzureEmbeddingWithModel(args: {
  runtime: EmbeddingRuntime;
  modelName: string;
  text: string;
}): Promise<{ embedding: number[] | null; errorCode: string | null }> {
  const endpoint = joinUrl(
    args.runtime.baseUrl || "",
    "openai/v1/embeddings?api-version=preview",
  );
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": args.runtime.apiKey || "",
    },
    body: JSON.stringify({
      model: args.modelName,
      input: args.text,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      embedding: null,
      errorCode: extractEmbeddingErrorCode(payload),
    };
  }
  return {
    embedding: extractEmbedding(payload),
    errorCode: null,
  };
}

async function requestAzureEmbeddingWithDeployment(args: {
  runtime: EmbeddingRuntime;
  deploymentName: string;
  text: string;
}): Promise<number[] | null> {
  const endpoint = joinUrl(
    args.runtime.baseUrl || "",
    `openai/deployments/${encodeURIComponent(args.deploymentName)}/embeddings?api-version=${encodeURIComponent(args.runtime.apiVersion)}`,
  );
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": args.runtime.apiKey || "",
    },
    body: JSON.stringify({
      input: args.text,
    }),
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  return extractEmbedding(payload);
}

async function generateEmbedding(
  appId: string,
  text: string,
  preferredEmbeddingModel?: string | null,
): Promise<number[] | null> {
  try {
    const runtime = await resolveEmbeddingRuntime(appId, preferredEmbeddingModel);
    if (!runtime.baseUrl || !runtime.apiKey) return null;
    const requestedModel =
      normalizeEmbeddingModel(preferredEmbeddingModel) ||
      normalizeEmbeddingModel(runtime.embeddingModelName) ||
      DEFAULT_EMBEDDING_MODEL;

    const isAzure =
      (runtime.provider || "").toLowerCase() === "azure" ||
      runtime.baseUrl.includes(".openai.azure.com");

    if (isAzure) {
      const primary = await requestAzureEmbeddingWithModel({
        runtime,
        modelName: requestedModel,
        text,
      });
      if (primary.embedding) return primary.embedding;

      if (
        primary.errorCode === "unavailable_model" &&
        requestedModel !== "text-embedding-ada-002"
      ) {
        const fallback = await requestAzureEmbeddingWithModel({
          runtime,
          modelName: "text-embedding-ada-002",
          text,
        });
        if (fallback.embedding) return fallback.embedding;
      }

      const deployment = runtime.deploymentName || requestedModel;
      return requestAzureEmbeddingWithDeployment({
        runtime,
        deploymentName: deployment,
        text,
      });
    }

    const endpoint = joinUrl(runtime.baseUrl, "/v1/embeddings");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runtime.apiKey}`,
      },
      body: JSON.stringify({
        model: requestedModel,
        input: text,
      }),
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    return extractEmbedding(payload);
  } catch (error) {
    console.warn("[KnowledgeService] Embedding request failed; using lexical fallback", {
      appId,
      error,
    });
    return null;
  }
}

async function resolveRetrievalEmbeddingModel(
  appId: string,
  sourceFilter: string[] | null,
): Promise<string> {
  type ModelRow = {
    embedding_model: string | null;
    total: number | string | null;
  };
  const rows = await prisma.$queryRawUnsafe<ModelRow[]>(
    `
				SELECT
					COALESCE("embedding_model", $3::text) AS embedding_model,
					COUNT(*)::bigint AS total
				FROM "knowledge_sources"
				WHERE "app_id" = $1::uuid
				  AND COALESCE("is_active", true) = true
				  AND COALESCE("status", 'pending') = 'ready'
				  AND ($2::uuid[] IS NULL OR "id" = ANY($2::uuid[]))
				GROUP BY COALESCE("embedding_model", $3::text)
				ORDER BY COUNT(*) DESC
				LIMIT 1
			`,
    appId,
    sourceFilter,
    DEFAULT_EMBEDDING_MODEL,
  );
  return (
    normalizeEmbeddingModel(rows[0]?.embedding_model) || DEFAULT_EMBEDDING_MODEL
  );
}

function toVectorLiteral(vector: number[]): string {
  const values = vector.map((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "0";
    return Number(numeric.toFixed(8)).toString();
  });
  return `[${values.join(",")}]`;
}

async function insertSourceFiles(args: {
  appId: string;
  chatbotId: string | null;
  sourceId: string;
  files: SourceFileInput[];
}) {
  for (const file of args.files) {
    const fileName = normalizeString(file.file_name) || "knowledge-source";
    const mimeType = normalizeString(file.mime_type);
    const fileSizeBytes = Math.max(
      0,
      Math.round(normalizeNumber(file.file_size_bytes, 0)),
    );
    const checksum = normalizeString(file.checksum_sha256);
    const storageKey = normalizeString(file.storage_key);
    const storageUrl = normalizeString(file.storage_url);
    const pageCount = Number.isFinite(Number(file.page_count))
      ? Number(file.page_count)
      : null;
    const durationMs = Number.isFinite(Number(file.duration_ms))
      ? Number(file.duration_ms)
      : null;
    const language = normalizeString(file.language);
    const extractionMetadata = safeJsonObject(file.extraction_metadata);

    await prisma.$executeRawUnsafe(
      `
				INSERT INTO "knowledge_source_files" (
					"id", "app_id", "chatbot_id", "source_id", "file_name", "mime_type", "file_size_bytes",
					"checksum_sha256", "storage_key", "storage_url", "extraction_metadata", "page_count", "duration_ms",
					"language", "status", "is_active", "created_at", "updated_at"
				)
				VALUES (
					gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9,
					$10::jsonb, $11, $12, $13, 'pending', true, NOW(), NOW()
				)
			`,
      args.appId,
      args.chatbotId,
      args.sourceId,
      fileName,
      mimeType,
      fileSizeBytes,
      checksum,
      storageKey,
      storageUrl,
      JSON.stringify(extractionMetadata),
      pageCount,
      durationMs,
      language,
    );
  }
}

function buildSyntheticSourceFile(input: SourceUpsertInput): SourceFileInput {
  const fileName =
    normalizeString(input.file_name) ||
    `${normalizeString(input.title) || "knowledge-source"}.${normalizeSourceFormat(input.type, input.format, input.file_type)}`;
  const mimeType = normalizeString(input.file_type);
  const fileSize = Number.isFinite(Number(input.file_size))
    ? Number(input.file_size)
    : Buffer.byteLength(String(input.content || ""), "utf8");
  return {
    file_name: fileName,
    mime_type: mimeType,
    file_size_bytes: fileSize,
    storage_url: normalizeString(input.source_url),
    extraction_metadata: {
      synthetic: true,
      source_type: normalizeString(input.source_type) || "manual",
    },
  };
}

async function createIngestionJob(args: {
  appId: string;
  chatbotId: string | null;
  sourceId: string;
  trigger: string;
  stage: string;
  status: string;
  payload?: Record<string, unknown>;
}) {
  await prisma.$executeRawUnsafe(
    `
			INSERT INTO "knowledge_ingestion_jobs" (
				"id", "app_id", "chatbot_id", "source_id", "trigger", "stage", "status",
				"attempts", "started_at", "payload", "created_at", "updated_at"
			)
			VALUES (
				gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
				1, NOW(), $7::jsonb, NOW(), NOW()
			)
		`,
    args.appId,
    args.chatbotId,
    args.sourceId,
    args.trigger,
    args.stage,
    args.status,
    JSON.stringify(args.payload || {}),
  );
}

export abstract class KnowledgeService {
  // Categories
  static async getCategories(appId: string) {
    const targetAppId = await resolveAppId(appId);
    return prisma.knowledge_categories.findMany({
      where: {
        app_id: targetAppId || undefined,
      },
      orderBy: [{ position: "asc" }, { name: "asc" }],
    });
  }

  static async createCategory(appId: string, data: any) {
    const targetAppId = await resolveAppId(appId);
    const payload =
      data && typeof data === "object" && !Array.isArray(data)
        ? ({ ...(data as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    delete payload.chatbot_id;
    return prisma.knowledge_categories.create({
      data: {
        ...(payload as any),
        chatbot_id: null,
        app_id: targetAppId || appId,
      },
    });
  }

  static async deleteCategory(id: string, appId: string) {
    const targetAppId = await resolveAppId(appId);
    return prisma.knowledge_categories.delete({
      where: { id, app_id: targetAppId || undefined },
    });
  }

  // Sources
  static async listSources(
    appId: string,
    params: {
      categoryId?: string;
      search?: string;
      limit?: number;
    } = {},
  ) {
    const targetAppId = await resolveAppId(appId);
    if (!targetAppId) return [];

    const categoryId = normalizeString(params.categoryId);
    const search = normalizeString(params.search);
    const limit = Math.max(
      1,
      Math.min(1000, Math.round(normalizeNumber(params.limit, 200))),
    );

    type SourceRow = {
      id: string;
      title: string | null;
      type: string | null;
      format: string | null;
      status: string | null;
      chunk_count: number | null;
      embedding_model: string | null;
      index_size_bytes: string | number | null;
      hit_count: number | null;
      updated_at: string | Date | null;
      metadata: unknown;
      file_size: number | null;
      source_url: string | null;
      file_name: string | null;
      source_type: string | null;
    };

    const rows = await prisma.$queryRawUnsafe<SourceRow[]>(
      `
				SELECT
					ks."id",
					ks."title",
					ks."type",
					ks."format",
					ks."status",
					ks."chunk_count",
					ks."embedding_model",
					ks."index_size_bytes",
					ks."hit_count",
					ks."updated_at",
					ks."metadata",
					ks."file_size",
					ks."source_url",
					ks."file_name",
					ks."source_type"
				FROM "knowledge_sources" ks
				WHERE ks."app_id" = $1::uuid
				  AND COALESCE(ks."is_active", true) = true
				  AND ($2::uuid IS NULL OR ks."category_id" = $2::uuid)
				  AND ($3::text IS NULL OR (COALESCE(ks."title", '') || ' ' || COALESCE(ks."content", '')) ILIKE '%' || $3 || '%')
				ORDER BY COALESCE(ks."updated_at", ks."created_at") DESC
				LIMIT $4
			`,
      targetAppId,
      categoryId,
      search,
      limit,
    );

    return rows.map((row) => {
      const metadata = safeJsonObject(row.metadata);
      const tags = toUuidArray(metadata.tags);
      const isPrivate = Boolean(metadata.is_private || metadata.private);
      const format = normalizeSourceFormat(row.type, row.format, null);
      const updated =
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : normalizeString(row.updated_at) || null;
      const sizeBytes = Math.max(
        0,
        Number(row.index_size_bytes || 0) || Number(row.file_size || 0) || 0,
      );
      return {
        id: row.id,
        title: row.title || "Knowledge Source",
        name: row.title || "Knowledge Source",
        type: row.type || format,
        format,
        status: normalizeSourceStatus(row.status),
        chunks: Math.max(0, Number(row.chunk_count || 0)),
        embedding: row.embedding_model || "text-embedding-3-small",
        hits: Math.max(0, Number(row.hit_count || 0)),
        size: formatBytes(sizeBytes),
        size_bytes: sizeBytes,
        updated,
        updated_at: updated,
        tags,
        is_private: isPrivate,
        source_url: row.source_url,
        file_name: row.file_name,
        source_type: row.source_type,
      };
    });
  }

  static async createSource(appId: string, input: SourceUpsertInput) {
    const targetAppId = await resolveAppId(appId);
    if (!targetAppId) throw new Error("Invalid app ID");

    const title = normalizeString(input.title);
    if (!title) throw new Error("title is required");

    const content = normalizeString(input.content) || "";
    const type = normalizeString(input.type) || "text";
    const format = normalizeSourceFormat(type, input.format, input.file_type);
    const embeddingModel =
      normalizeEmbeddingModel(input.embedding_model) || DEFAULT_EMBEDDING_MODEL;
    const embeddingDimension = resolveEmbeddingDimension(embeddingModel);
    const metadata = safeJsonObject(input.metadata);
    const sourceType = normalizeString(input.source_type) || "manual";
    const sourceUrl = normalizeString(input.source_url);
    const fileName = normalizeString(input.file_name);
    const fileType = normalizeString(input.file_type);
    const fileSize = Number.isFinite(Number(input.file_size))
      ? Number(input.file_size)
      : null;
    const categoryId = normalizeString(input.category_id);

    type CreatedSource = {
      id: string;
      title: string;
    };

    const createdRows = await prisma.$queryRawUnsafe<CreatedSource[]>(
      `
				INSERT INTO "knowledge_sources" (
					"id", "title", "content", "type", "format", "metadata", "created_at", "app_id", "chatbot_id", "category_id",
					"source_type", "source_url", "file_name", "file_size", "file_type", "status", "error_message", "chunk_count",
					"embedding_model", "embedding_dimension", "index_size_bytes", "hit_count", "active_version", "is_active", "updated_at"
				)
					VALUES (
						gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, NOW(), $6::uuid, NULL, $7::uuid,
						$8, $9, $10, $11, $12, 'pending', NULL, 0,
						$13, $14, 0, 0, 1, true, NOW()
					)
					RETURNING "id", "title"
				`,
      title,
      content,
      type,
      format,
      JSON.stringify(metadata),
      targetAppId,
      categoryId,
      sourceType,
      sourceUrl,
      fileName,
      fileSize,
      fileType,
      embeddingModel,
      embeddingDimension,
    );
    const created = createdRows[0];
    if (!created) throw new Error("Failed creating knowledge source");

    const files =
      Array.isArray(input.files) && input.files.length > 0
        ? input.files
        : [buildSyntheticSourceFile(input)];
    await insertSourceFiles({
      appId: targetAppId,
      chatbotId: null,
      sourceId: created.id,
      files,
    });

    await createIngestionJob({
      appId: targetAppId,
      chatbotId: null,
      sourceId: created.id,
      trigger: "manual",
      stage: "ingest",
      status: "pending",
      payload: {
        action: "create",
        format,
        embedding_model: embeddingModel,
        files: files.length,
      },
    });

    void KnowledgeIndexService.enqueueKnowledgeChangeEvent({
      action: "create",
      entity: "source",
      app_id: targetAppId,
      knowledge_id: created.id,
      timestamp: new Date().toISOString(),
    }).catch((error) => {
      console.error("[KnowledgeService] Failed enqueue source create", error);
    });

    return created;
  }

  static async getSource(id: string, appId: string) {
    const targetAppId = await resolveAppId(appId);
    if (!targetAppId) throw new Error("Invalid app ID");

    type SourceDetailRow = {
      id: string;
      title: string | null;
      content: string | null;
      type: string | null;
      format: string | null;
      metadata: unknown;
      created_at: Date | string | null;
      updated_at: Date | string | null;
      source_type: string | null;
      source_url: string | null;
      file_name: string | null;
      file_size: number | null;
      file_type: string | null;
      category_id: string | null;
      status: string | null;
      error_message: string | null;
      chunk_count: number | null;
      embedding_model: string | null;
      index_size_bytes: number | null;
      hit_count: number | null;
    };

    const rows = await prisma.$queryRawUnsafe<SourceDetailRow[]>(
      `
        SELECT
          "id", "title", "content", "type", "format", "metadata", "created_at", "updated_at",
          "source_type", "source_url", "file_name", "file_size", "file_type", "category_id",
          "status", "error_message", "chunk_count", "embedding_model", "index_size_bytes", "hit_count"
        FROM "knowledge_sources"
        WHERE "id" = $1::uuid
          AND "app_id" = $2::uuid
          AND COALESCE("is_active", true) = true
        LIMIT 1
      `,
      id,
      targetAppId,
    );
    const row = rows[0];
    if (!row) return null;

    const metadata = safeJsonObject(row.metadata);
    const format = normalizeSourceFormat(row.type, row.format, row.file_type);
    const updated =
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : normalizeString(row.updated_at) || null;
    const created =
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : normalizeString(row.created_at) || null;
    const sizeBytes = Math.max(
      0,
      Number(row.index_size_bytes || 0) || Number(row.file_size || 0) || 0,
    );

    return {
      id: row.id,
      title: row.title || "Knowledge Source",
      name: row.title || "Knowledge Source",
      content: row.content || "",
      type: row.type || format,
      format,
      metadata,
      source_type: row.source_type,
      source_url: row.source_url,
      file_name: row.file_name,
      file_size: row.file_size,
      file_type: row.file_type,
      category_id: row.category_id,
      status: normalizeSourceStatus(row.status),
      error_message: row.error_message,
      chunks: Math.max(0, Number(row.chunk_count || 0)),
      chunk_count: Math.max(0, Number(row.chunk_count || 0)),
      embedding: row.embedding_model || DEFAULT_EMBEDDING_MODEL,
      embedding_model: row.embedding_model || DEFAULT_EMBEDDING_MODEL,
      hits: Math.max(0, Number(row.hit_count || 0)),
      hit_count: Math.max(0, Number(row.hit_count || 0)),
      size: formatBytes(sizeBytes),
      size_bytes: sizeBytes,
      tags: toUuidArray(metadata.tags),
      is_private: Boolean(metadata.is_private || metadata.private),
      created,
      created_at: created,
      updated,
      updated_at: updated,
    };
  }

  static async updateSource(
    id: string,
    appId: string,
    input: Partial<SourceUpsertInput>,
  ) {
    const targetAppId = await resolveAppId(appId);
    if (!targetAppId) throw new Error("Invalid app ID");

    type ExistingRow = {
      id: string;
      title: string;
      content: string | null;
      type: string | null;
      format: string | null;
      metadata: unknown;
      source_type: string | null;
      source_url: string | null;
      file_name: string | null;
      file_size: number | null;
      file_type: string | null;
      category_id: string | null;
      embedding_model: string | null;
    };

    const existingRows = await prisma.$queryRawUnsafe<ExistingRow[]>(
      `
					SELECT
						"id", "title", "content", "type", "format", "metadata", "source_type", "source_url",
						"file_name", "file_size", "file_type", "category_id", "embedding_model"
					FROM "knowledge_sources"
				WHERE "id" = $1::uuid
				  AND "app_id" = $2::uuid
				  AND COALESCE("is_active", true) = true
				LIMIT 1
			`,
      id,
      targetAppId,
    );
    const existing = existingRows[0];
    if (!existing) return null;

    const nextTitle = normalizeString(input.title) || existing.title;
    const hasContentInput = Object.prototype.hasOwnProperty.call(
      input,
      "content",
    );
    const nextContent = hasContentInput
      ? normalizeString(input.content) || ""
      : existing.content || "";
    const nextType = normalizeString(input.type) || existing.type || "text";
    const nextFormat = normalizeSourceFormat(
      nextType,
      input.format || existing.format,
      input.file_type || existing.file_type,
    );
    const nextMetadata = {
      ...safeJsonObject(existing.metadata),
      ...safeJsonObject(input.metadata),
    };
    const nextSourceType =
      normalizeString(input.source_type) || existing.source_type || "manual";
    const nextSourceUrl =
      normalizeString(input.source_url) || existing.source_url;
    const nextFileName = normalizeString(input.file_name) || existing.file_name;
    const nextFileType = normalizeString(input.file_type) || existing.file_type;
    const nextFileSize = Number.isFinite(Number(input.file_size))
      ? Number(input.file_size)
      : existing.file_size;
    const nextCategoryId =
      normalizeString(input.category_id) || existing.category_id;
    const nextEmbeddingModel =
      normalizeEmbeddingModel(input.embedding_model) ||
      normalizeEmbeddingModel(existing.embedding_model) ||
      DEFAULT_EMBEDDING_MODEL;
    const nextEmbeddingDimension =
      resolveEmbeddingDimension(nextEmbeddingModel);

    await prisma.$executeRawUnsafe(
      `
				UPDATE "knowledge_sources"
				SET
					"title" = $1,
					"content" = $2,
					"type" = $3,
					"format" = $4,
					"metadata" = $5::jsonb,
					"source_type" = $6,
					"source_url" = $7,
					"file_name" = $8,
					"file_size" = $9,
					"file_type" = $10,
					"category_id" = $11::uuid,
					"embedding_model" = $12,
					"embedding_dimension" = $13,
					"status" = 'pending',
					"error_message" = NULL,
					"updated_at" = NOW()
				WHERE "id" = $14::uuid
				  AND "app_id" = $15::uuid
			`,
      nextTitle,
      nextContent,
      nextType,
      nextFormat,
      JSON.stringify(nextMetadata),
      nextSourceType,
      nextSourceUrl,
      nextFileName,
      nextFileSize,
      nextFileType,
      nextCategoryId,
      nextEmbeddingModel,
      nextEmbeddingDimension,
      id,
      targetAppId,
    );

    const files =
      Array.isArray(input.files) && input.files.length > 0 ? input.files : [];
    if (files.length > 0) {
      await insertSourceFiles({
        appId: targetAppId,
        chatbotId: null,
        sourceId: id,
        files,
      });
    }

    await createIngestionJob({
      appId: targetAppId,
      chatbotId: null,
      sourceId: id,
      trigger: "manual",
      stage: "ingest",
      status: "pending",
      payload: {
        action: "update",
        embedding_model: nextEmbeddingModel,
        files: files.length,
      },
    });

    void KnowledgeIndexService.enqueueKnowledgeChangeEvent({
      action: "update",
      entity: "source",
      app_id: targetAppId,
      knowledge_id: id,
      timestamp: new Date().toISOString(),
    }).catch((error) => {
      console.error("[KnowledgeService] Failed enqueue source update", error);
    });

    return {
      id,
      title: nextTitle,
    };
  }

  static async archiveSource(id: string, appId: string) {
    const targetAppId = await resolveAppId(appId);
    if (!targetAppId) throw new Error("Invalid app ID");

    type ExistingRow = {
      id: string;
    };
    const rows = await prisma.$queryRawUnsafe<ExistingRow[]>(
      `
				SELECT "id"
				FROM "knowledge_sources"
				WHERE "id" = $1::uuid
				  AND "app_id" = $2::uuid
				  AND COALESCE("is_active", true) = true
				LIMIT 1
			`,
      id,
      targetAppId,
    );
    const row = rows[0];
    if (!row) return null;

    await prisma.$executeRawUnsafe(
      `
				UPDATE "knowledge_sources"
				SET
					"is_active" = false,
					"status" = 'archived',
					"updated_at" = NOW()
				WHERE "id" = $1::uuid
				  AND "app_id" = $2::uuid
			`,
      id,
      targetAppId,
    );

    await createIngestionJob({
      appId: targetAppId,
      chatbotId: null,
      sourceId: id,
      trigger: "manual",
      stage: "purge",
      status: "pending",
      payload: { action: "delete" },
    });

    void KnowledgeIndexService.enqueueKnowledgeChangeEvent({
      action: "delete",
      entity: "source",
      app_id: targetAppId,
      knowledge_id: id,
      timestamp: new Date().toISOString(),
    }).catch((error) => {
      console.error("[KnowledgeService] Failed enqueue source delete", error);
    });

    return { id };
  }

  static async retrievalTest(
    appId: string,
    params: {
      query: string;
      selectedSourceIds?: string[];
      topK?: number;
      modelId?: string;
      provider?: string;
      channel?: RetrievalChannel;
    },
  ) {
    const targetAppId = await resolveAppId(appId);
    if (!targetAppId) throw new Error("Invalid app ID");

    const queryText = normalizeString(params.query);
    if (!queryText) throw new Error("query is required");
    const selectedSourceFilterRequested =
      Array.isArray(params.selectedSourceIds) &&
      params.selectedSourceIds.length > 0;
    const selectedSourceIds = toStrictUuidArray(params.selectedSourceIds);
    const topK = Math.max(
      1,
      Math.min(
        MAX_TOP_K,
        Math.round(normalizeNumber(params.topK, DEFAULT_TOP_K)),
      ),
    );
    const thresholdUsed = DEFAULT_RAG_THRESHOLD;
    const channel: RetrievalChannel =
      params.channel === "live" ? "live" : "test";
    const sourceFilter = selectedSourceFilterRequested
      ? selectedSourceIds
      : null;
    let retrievalProvider = normalizeString(params.provider)?.toLowerCase() || null;
    let retrievalModelId = normalizeString(params.modelId);

    if (!retrievalProvider || !retrievalModelId) {
      const providerConfigs = (await AIService.getProviderConfigurations().catch(
        () => null,
      )) as
        | {
            active_provider?: string | null;
            providers?: Record<string, { model_name?: string | null } | null>;
          }
        | null;
      const activeProvider =
        normalizeString(providerConfigs?.active_provider)?.toLowerCase() || null;
      const activeConfig =
        activeProvider && providerConfigs?.providers
          ? providerConfigs.providers[activeProvider]
          : null;

      if (!retrievalProvider) retrievalProvider = activeProvider;
      if (!retrievalModelId) {
        retrievalModelId = normalizeString(activeConfig?.model_name);
      }
    }

    const start = Date.now();
    const preferredEmbeddingModel = await resolveRetrievalEmbeddingModel(
      targetAppId,
      sourceFilter,
    );
    const vectorRaw = await generateEmbedding(
      targetAppId,
      queryText,
      preferredEmbeddingModel,
    );
    const vector = vectorRaw && vectorRaw.length === 1536 ? vectorRaw : null;
    let rows: KnowledgeChunkCandidate[] = [];

    if (vector && vector.length > 0) {
      rows = await prisma.$queryRawUnsafe<KnowledgeChunkCandidate[]>(
        `
					SELECT
						kc."id",
						kc."source_id",
						COALESCE(ks."title", 'Knowledge Source') AS source_title,
						kc."chunk_index",
						kc."chunk_text",
						COALESCE(kc."locator_label", CONCAT('sec.', kc."chunk_index" + 1)) AS "locator_label",
						(
							((1 - (kc."embedding" <=> $1::vector))::float8 * 10) +
							(COALESCE(ts_rank_cd(kc."chunk_tsv", websearch_to_tsquery('simple', $2)), 0)::float8 * 3)
						) AS score
						FROM "knowledge_chunks" kc
						JOIN "knowledge_sources" ks ON ks."id" = kc."source_id"
						WHERE kc."app_id" = $3::uuid
						  AND COALESCE(ks."is_active", true) = true
						  AND COALESCE(ks."status", 'pending') = 'ready'
						  AND ($4::uuid[] IS NULL OR kc."source_id" = ANY($4::uuid[]))
						  AND COALESCE(kc."embedding_model", $6::text) = $6::text
						  AND kc."embedding" IS NOT NULL
						ORDER BY score DESC
						LIMIT $5
						`,
        toVectorLiteral(vector),
        queryText,
        targetAppId,
        sourceFilter,
        topK,
        preferredEmbeddingModel,
      );
    }

    if (rows.length === 0) {
      rows = await prisma.$queryRawUnsafe<KnowledgeChunkCandidate[]>(
        `
					SELECT
						kc."id",
						kc."source_id",
						COALESCE(ks."title", 'Knowledge Source') AS source_title,
						kc."chunk_index",
						kc."chunk_text",
						COALESCE(kc."locator_label", CONCAT('sec.', kc."chunk_index" + 1)) AS "locator_label",
						(
							COALESCE(ts_rank_cd(kc."chunk_tsv", websearch_to_tsquery('simple', $1)), 0)::float8 * 3
						) AS score
						FROM "knowledge_chunks" kc
						JOIN "knowledge_sources" ks ON ks."id" = kc."source_id"
						WHERE kc."app_id" = $2::uuid
						  AND COALESCE(ks."is_active", true) = true
						  AND COALESCE(ks."status", 'pending') = 'ready'
						  AND ($3::uuid[] IS NULL OR kc."source_id" = ANY($3::uuid[]))
						ORDER BY score DESC
						LIMIT $4
					`,
        queryText,
        targetAppId,
        sourceFilter,
        topK,
      );
    }
    rows = rows.filter(
      (row) =>
        !isAgentBehaviorPromptKnowledge(row.source_title, row.chunk_text),
    );

    const retrievalMs = Math.max(1, Date.now() - start);
    const topChunks = rows.map((row) => ({
      score: Number(Number(row.score || 0).toFixed(6)),
      source: row.source_title,
      locator: row.locator_label || `sec.${row.chunk_index + 1}`,
      snippet: normalizeChunkTextForReply(row.chunk_text, 420),
      chunkId: row.id,
      sourceId: row.source_id,
    }));

    const hitChunks = topChunks.filter((item) => item.score >= thresholdUsed);
    const ragHit = hitChunks.length > 0;
    const groundedSources = new Set(hitChunks.map((item) => item.sourceId))
      .size;

    const answerParts = rows
      .filter((row) => Number(row.score || 0) >= thresholdUsed)
      .map((row) => normalizeChunkTextForReply(row.chunk_text))
      .filter((item) => item.length > 0);

    const answer =
      answerParts.length > 0
        ? answerParts.join("\n\n")
        : "Belum ada chunk relevan dari knowledge yang dipilih.";
    const promptTokens = estimateTokenCount(queryText);
    const completionTokens = estimateTokenCount(answer);
    const totalTokens = promptTokens + completionTokens;
    const usageUsd = Number((totalTokens * 0.0000004).toFixed(6));
    const usageCredits = Number((totalTokens * 0.001).toFixed(6));
    const usageIdr = Number((usageUsd * 16000).toFixed(6));

    const logId = await this.logRetrievalObservation({
      appId: targetAppId,
      channel,
      queryText,
      selectedSourceIds,
      topK,
      retrievalMs,
      thresholdUsed,
      retrievalProvider,
      retrievalModelId,
      answerText: answer,
      promptTokens,
      completionTokens,
      totalTokens,
      usageCredits,
      usageUsd,
      usageIdr,
      chunks: topChunks.map((chunk, index) => ({
        chunkId: chunk.chunkId,
        sourceId: chunk.sourceId,
        rank: index + 1,
        score: chunk.score,
        locatorLabel: chunk.locator,
        snippet: chunk.snippet,
      })),
    });

    return {
      queryLogId: logId,
      latencyMs: retrievalMs,
      topChunks: topChunks.map((chunk) => ({
        score: chunk.score,
        source: chunk.source,
        locator: chunk.locator,
        snippet: chunk.snippet,
      })),
      answer,
      groundedSources,
      tokens: totalTokens,
      cost: `$${usageUsd.toFixed(4)}`,
      ragHit,
      hitChunkCount: hitChunks.length,
      provider: retrievalProvider,
      modelId: retrievalModelId,
    };
  }

  static async analytics(
    appId: string,
    params: {
      windowHours?: number;
      channel?: "all" | RetrievalChannel;
    } = {},
  ) {
    const targetAppId = await resolveAppId(appId);
    if (!targetAppId) throw new Error("Invalid app ID");

    const windowHours = Math.max(
      1,
      Math.min(24 * 14, Math.round(normalizeNumber(params.windowHours, 24))),
    );
    const channel =
      params.channel === "test" || params.channel === "live"
        ? params.channel
        : "all";

    type AggregateRow = {
      total_queries: number | string | null;
      avg_retrieval_ms: number | string | null;
      rag_hit_rate: number | string | null;
    };
    type IndexRow = {
      index_size_bytes: number | string | null;
    };
    type BreakdownRow = {
      channel: string | null;
      queries: number | string | null;
      avg_retrieval_ms: number | string | null;
      rag_hit_rate: number | string | null;
    };

    const aggregateRows = await prisma.$queryRawUnsafe<AggregateRow[]>(
      `
				SELECT
					COUNT(*)::bigint AS total_queries,
					COALESCE(AVG(COALESCE("retrieval_ms", 0)), 0)::float8 AS avg_retrieval_ms,
					CASE
						WHEN COUNT(*) = 0 THEN 0
						ELSE (SUM(CASE WHEN COALESCE("rag_hit", false) THEN 1 ELSE 0 END)::float8 / COUNT(*)::float8) * 100
					END AS rag_hit_rate
					FROM "knowledge_query_logs"
					WHERE "app_id" = $1::uuid
					  AND "created_at" >= (NOW() - (($2::text || ' hours')::interval))
					  AND ($3::text = 'all' OR COALESCE("channel", 'live') = $3::text)
				`,
      targetAppId,
      String(windowHours),
      channel,
    );
    const aggregate = aggregateRows[0];

    const indexRows = await prisma.$queryRawUnsafe<IndexRow[]>(
      `
					SELECT COALESCE(SUM(COALESCE("index_size_bytes", 0)), 0) AS index_size_bytes
					FROM "knowledge_sources"
					WHERE "app_id" = $1::uuid
					  AND COALESCE("is_active", true) = true
					  AND COALESCE("status", 'pending') = 'ready'
				`,
      targetAppId,
    );

    const breakdown = await prisma.$queryRawUnsafe<BreakdownRow[]>(
      `
				SELECT
					COALESCE("channel", 'live') AS channel,
					COUNT(*)::bigint AS queries,
					COALESCE(AVG(COALESCE("retrieval_ms", 0)), 0)::float8 AS avg_retrieval_ms,
					CASE
						WHEN COUNT(*) = 0 THEN 0
						ELSE (SUM(CASE WHEN COALESCE("rag_hit", false) THEN 1 ELSE 0 END)::float8 / COUNT(*)::float8) * 100
					END AS rag_hit_rate
					FROM "knowledge_query_logs"
					WHERE "app_id" = $1::uuid
					  AND "created_at" >= (NOW() - (($2::text || ' hours')::interval))
					GROUP BY COALESCE("channel", 'live')
					ORDER BY channel
				`,
      targetAppId,
      String(windowHours),
    );

    return {
      windowHours,
      channel,
      totalQueries24h: Math.max(0, Number(aggregate?.total_queries || 0)),
      avgRetrievalMs: Number(
        Number(aggregate?.avg_retrieval_ms || 0).toFixed(2),
      ),
      ragHitRate: Number(Number(aggregate?.rag_hit_rate || 0).toFixed(2)),
      indexSizeBytes: Math.max(0, Number(indexRows[0]?.index_size_bytes || 0)),
      breakdown: breakdown.map((row) => ({
        channel: row.channel || "live",
        queries: Math.max(0, Number(row.queries || 0)),
        avgRetrievalMs: Number(Number(row.avg_retrieval_ms || 0).toFixed(2)),
        ragHitRate: Number(Number(row.rag_hit_rate || 0).toFixed(2)),
      })),
    };
  }

  static async logRetrievalObservation(
    input: RetrievalObservationInput,
  ): Promise<string | null> {
    const queryText = normalizeString(input.queryText);
    if (!queryText) return null;
    const appId = normalizeString(input.appId);
    if (!appId) return null;
    const channel = input.channel === "test" ? "test" : "live";
    const topK = Math.max(
      1,
      Math.min(
        MAX_TOP_K,
        Math.round(normalizeNumber(input.topK, DEFAULT_TOP_K)),
      ),
    );
    const retrievalMs = Math.max(
      0,
      Math.round(normalizeNumber(input.retrievalMs, 0)),
    );
    const thresholdUsed = Number(
      normalizeNumber(input.thresholdUsed, DEFAULT_RAG_THRESHOLD).toFixed(6),
    );
    const chunks = Array.isArray(input.chunks) ? input.chunks : [];
    const normalizedChunks = chunks
      .filter((item) => Number.isFinite(Number(item.rank)))
      .map((item) => ({
        chunkId: normalizeString(item.chunkId),
        sourceId: normalizeString(item.sourceId),
        rank: Math.max(1, Math.round(normalizeNumber(item.rank, 1))),
        score: Number(Number(normalizeNumber(item.score, 0)).toFixed(6)),
        locatorLabel: normalizeString(item.locatorLabel),
        snippet: normalizeString(item.snippet),
      }))
      .sort((left, right) => left.rank - right.rank)
      .slice(0, topK);

    const hitChunks = normalizedChunks.filter(
      (item) => item.score >= thresholdUsed,
    );
    const ragHit = hitChunks.length > 0;
    const hitChunkCount = hitChunks.length;
    const avgTopkScore =
      normalizedChunks.length > 0
        ? normalizedChunks.reduce((sum, item) => sum + item.score, 0) /
          normalizedChunks.length
        : 0;

    const selectedSourceIds = toStrictUuidArray(input.selectedSourceIds);
    const promptTokens = Math.max(
      0,
      Math.round(normalizeNumber(input.promptTokens, 0)),
    );
    const completionTokens = Math.max(
      0,
      Math.round(normalizeNumber(input.completionTokens, 0)),
    );
    const totalTokens = Math.max(
      0,
      Math.round(
        normalizeNumber(input.totalTokens, promptTokens + completionTokens),
      ),
    );
    const usageCredits = Number(
      normalizeNumber(input.usageCredits, 0).toFixed(6),
    );
    const usageUsd = Number(normalizeNumber(input.usageUsd, 0).toFixed(6));
    const usageIdr = Number(normalizeNumber(input.usageIdr, 0).toFixed(6));
    const answerText = normalizeString(input.answerText);
    const retrievalProvider = normalizeString(input.retrievalProvider);
    const retrievalModelId = normalizeString(input.retrievalModelId);
    const metadata: Record<string, unknown> = {};
    if (retrievalProvider) metadata.retrieval_provider = retrievalProvider;
    if (retrievalModelId) metadata.retrieval_model_id = retrievalModelId;

    type LogRow = { id: string };
    const logRows = await prisma.$queryRawUnsafe<LogRow[]>(
      `
				INSERT INTO "knowledge_query_logs" (
					"id", "app_id", "chatbot_id", "channel", "query_text", "selected_source_ids",
					"top_k", "retrieval_ms", "rag_hit", "hit_chunk_count", "avg_topk_score", "threshold_used",
					"prompt_tokens", "completion_tokens", "total_tokens", "usage_credits", "usage_usd", "usage_idr",
					"answer_text", "metadata", "created_at", "updated_at"
					)
					VALUES (
						gen_random_uuid(), $1::uuid, NULL, $2, $3, $4::jsonb,
						$5, $6, $7, $8, $9, $10,
						$11, $12, $13, $14, $15, $16,
						$17, $18::jsonb, NOW(), NOW()
					)
					RETURNING "id"
				`,
      appId,
      channel,
      queryText,
      JSON.stringify(selectedSourceIds),
      topK,
      retrievalMs,
      ragHit,
      hitChunkCount,
      avgTopkScore,
      thresholdUsed,
      promptTokens,
      completionTokens,
      totalTokens,
      usageCredits,
      usageUsd,
      usageIdr,
      answerText,
      JSON.stringify(metadata),
    );
    const logId = logRows[0]?.id || null;
    if (!logId) return null;

    for (const chunk of normalizedChunks) {
      await prisma.$executeRawUnsafe(
        `
						INSERT INTO "knowledge_query_chunks" (
							"id", "app_id", "chatbot_id", "query_log_id", "chunk_id", "source_id", "rank",
						"score", "locator_label", "snippet", "created_at"
					)
					VALUES (
							gen_random_uuid(), $1::uuid, NULL, $2::uuid, $3::uuid, $4::uuid, $5,
							$6, $7, $8, NOW()
						)
					`,
        appId,
        logId,
        chunk.chunkId,
        chunk.sourceId,
        chunk.rank,
        chunk.score,
        chunk.locatorLabel,
        chunk.snippet,
      );
    }

    const uniqueSourceIds = [
      ...new Set(
        normalizedChunks
          .map((item) => item.sourceId)
          .filter((item): item is string => Boolean(item && isUuid(item))),
      ),
    ];
    if (uniqueSourceIds.length > 0) {
      await prisma.$executeRawUnsafe(
        `
					UPDATE "knowledge_sources"
					SET
						"hit_count" = COALESCE("hit_count", 0) + 1,
						"last_hit_at" = NOW(),
						"updated_at" = NOW()
					WHERE "id" = ANY($1::uuid[])
				`,
        uniqueSourceIds,
      );
    }

    return logId;
  }

  static async enqueueReindexSources(appId: string) {
    const targetAppId = await resolveAppId(appId);
    if (!targetAppId) throw new Error("Invalid app ID");

    type SourceRow = { id: string };
    const rows = await prisma.$queryRawUnsafe<SourceRow[]>(
      `
				SELECT "id"
				FROM "knowledge_sources"
				WHERE "app_id" = $1::uuid
				  AND COALESCE("is_active", true) = true
			`,
      targetAppId,
    );

    for (const row of rows) {
      void KnowledgeIndexService.enqueueKnowledgeChangeEvent({
        action: "update",
        entity: "source",
        app_id: targetAppId,
        knowledge_id: row.id,
        timestamp: new Date().toISOString(),
      }).catch((error) => {
        console.error(
          "[KnowledgeService] Failed enqueue source reindex",
          error,
        );
      });
    }

    return {
      enqueued: rows.length,
    };
  }

  // FAQs
  static async getFAQs(appId: string, filter: any = {}) {
    const targetAppId = await resolveAppId(appId);
    return prisma.knowledge_faqs.findMany({
      where: {
        app_id: targetAppId || undefined,
        is_active: true,
        category_id: filter.category_id || undefined,
        OR: filter.search
          ? [
              { question: { contains: filter.search, mode: "insensitive" } },
              { answer: { contains: filter.search, mode: "insensitive" } },
            ]
          : undefined,
      },
      orderBy: [{ priority: "desc" }, { created_at: "desc" }],
    });
  }

  static async createFAQ(appId: string, data: any) {
    const targetAppId = await resolveAppId(appId);
    const payload =
      data && typeof data === "object" && !Array.isArray(data)
        ? ({ ...(data as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    delete payload.chatbot_id;
    const created = await prisma.knowledge_faqs.create({
      data: {
        ...(payload as any),
        chatbot_id: null,
        app_id: targetAppId || appId,
      },
    });

    const appIdForEvent = targetAppId || appId;
    if (created?.id && appIdForEvent) {
      void KnowledgeIndexService.enqueueKnowledgeChangeEvent({
        action: "create",
        entity: "faq",
        app_id: appIdForEvent,
        knowledge_id: created.id,
        timestamp: new Date().toISOString(),
      }).catch((error) => {
        console.error(
          "[KnowledgeService] Failed enqueue knowledge_change_events for faq create",
          error,
        );
      });
    }

    return created;
  }

  static async updateFAQ(id: string, appId: string, data: any) {
    const targetAppId = await resolveAppId(appId);
    const payload =
      data && typeof data === "object" && !Array.isArray(data)
        ? ({ ...(data as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    delete payload.chatbot_id;
    const updated = await prisma.knowledge_faqs.update({
      where: { id, app_id: targetAppId || undefined },
      data: {
        ...(payload as any),
        chatbot_id: null,
        updated_at: new Date(),
      },
    });

    const appIdForEvent = targetAppId || appId;
    if (updated?.id && appIdForEvent) {
      void KnowledgeIndexService.enqueueKnowledgeChangeEvent({
        action: "update",
        entity: "faq",
        app_id: appIdForEvent,
        knowledge_id: updated.id,
        timestamp: new Date().toISOString(),
      }).catch((error) => {
        console.error(
          "[KnowledgeService] Failed enqueue knowledge_change_events for faq update",
          error,
        );
      });
    }

    return updated;
  }

  static async deleteFAQ(id: string, appId: string) {
    const targetAppId = await resolveAppId(appId);
    const deleted = await prisma.knowledge_faqs.update({
      where: { id, app_id: targetAppId || undefined },
      data: {
        is_active: false,
        chatbot_id: null,
        updated_at: new Date(),
      },
    });

    const appIdForEvent = targetAppId || appId;
    if (deleted?.id && appIdForEvent) {
      void KnowledgeIndexService.enqueueKnowledgeChangeEvent({
        action: "delete",
        entity: "faq",
        app_id: appIdForEvent,
        knowledge_id: deleted.id,
        timestamp: new Date().toISOString(),
      }).catch((error) => {
        console.error(
          "[KnowledgeService] Failed enqueue knowledge_change_events for faq delete",
          error,
        );
      });
    }

    return deleted;
  }

  // Stats
  static async getStats(appId: string) {
    const targetAppId = await resolveAppId(appId);
    const [sourcesCount, faqsCount, categoriesCount] = await Promise.all([
      prisma.knowledge_sources.count({
        where: {
          app_id: targetAppId || undefined,
          is_active: true,
        },
      }),
      prisma.knowledge_faqs.count({
        where: {
          app_id: targetAppId || undefined,
          is_active: true,
        },
      }),
      prisma.knowledge_categories.count({
        where: {
          app_id: targetAppId || undefined,
        },
      }),
    ]);

    return {
      sources_count: sourcesCount,
      faqs_count: faqsCount,
      categories_count: categoriesCount,
    };
  }
}

export const __test__ = {
  normalizeSourceStatus,
  normalizeSourceFormat,
  estimateTokenCount,
  formatBytes,
  isUuid,
  toUuidArray,
  toStrictUuidArray,
  safeJsonObject,
  toVectorLiteral,
};
