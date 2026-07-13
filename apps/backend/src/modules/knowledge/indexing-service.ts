import crypto from "crypto";
import prisma from "../../lib/prisma";
import redis from "../../lib/redis";
import { maintenanceQueue } from "../../lib/queue";
import { AIService } from "../ai/service";
import { KnowledgeExtractionService } from "./extraction-service";

export type KnowledgeChangeAction = "create" | "update" | "delete";
export type KnowledgeChangeEntity = "source" | "faq";

export type KnowledgeChangeEventPayload = {
  action: KnowledgeChangeAction;
  entity: KnowledgeChangeEntity;
  app_id: string;
  chatbot_id?: string | null;
  knowledge_id: string;
  timestamp?: string;
};

type KnowledgeSyncRuntime = {
  provider: string | null;
  baseUrl: string | null;
  apiKey: string | null;
  apiVersion: string;
  deploymentName: string | null;
  embeddingModelName: string;
};

type EmbeddingChunk = {
  index: number;
  content: string;
  embedding: number[] | null;
  embeddingDimension: number | null;
  chunkHash: string;
  charCount: number;
  tokenCount: number;
  locatorLabel: string;
  locatorJson: Record<string, unknown>;
};

const KNOWLEDGE_CHANGE_EVENT_JOB = "knowledge-change-event";
const KNOWLEDGE_SYNC_JOB = "sync-knowledge-index";
const KNOWLEDGE_PURGE_JOB = "purge-knowledge-index";

const RETRIEVAL_CACHE_PREFIX = "rag:knowledge:";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const SUPPORTED_EMBEDDING_MODELS = new Set([
  "text-embedding-3-small",
  "text-embedding-ada-002",
]);

const MAX_EMBEDDING_CHUNKS = Math.max(
  1,
  Math.min(1_000, Number(process.env.KNOWLEDGE_MAX_EMBEDDING_CHUNKS || 200)),
);
const EMBEDDING_CHUNK_SIZE = Math.max(
  300,
  Math.min(4_000, Number(process.env.KNOWLEDGE_EMBEDDING_CHUNK_SIZE || 1_000)),
);
const EMBEDDING_CHUNK_OVERLAP = Math.max(
  0,
  Math.min(
    Math.floor(EMBEDDING_CHUNK_SIZE / 2),
    Number(process.env.KNOWLEDGE_EMBEDDING_CHUNK_OVERLAP || 120),
  ),
);

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeEmbeddingModel(value: unknown): string | null {
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized) return null;
  if (!SUPPORTED_EMBEDDING_MODELS.has(normalized)) return null;
  return normalized;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

function estimateTokenCount(text: string): number {
  if (!text.trim()) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function normalizeAction(value: unknown): KnowledgeChangeAction {
  const normalized = normalizeString(value);
  if (
    normalized === "create" ||
    normalized === "update" ||
    normalized === "delete"
  ) {
    return normalized;
  }
  return "update";
}

function normalizeEntity(value: unknown): KnowledgeChangeEntity {
  const normalized = normalizeString(value);
  if (normalized === "faq") return "faq";
  return "source";
}

function normalizePayload(value: unknown): KnowledgeChangeEventPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid knowledge lifecycle payload");
  }
  const record = value as Record<string, unknown>;
  const appId = normalizeString(record.app_id);
  const knowledgeId = normalizeString(record.knowledge_id);
  if (!appId || !knowledgeId) {
    throw new Error("knowledge lifecycle payload is missing required fields");
  }
  return {
    action: normalizeAction(record.action),
    entity: normalizeEntity(record.entity),
    app_id: appId,
    chatbot_id: normalizeString(record.chatbot_id),
    knowledge_id: knowledgeId,
    timestamp: normalizeString(record.timestamp) || new Date().toISOString(),
  };
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.replace(/^\/+/, "");
  return `${base}/${suffix}`;
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

function splitIntoChunks(text: string): string[] {
  const normalized = stripHtml(String(text || ""));
  if (!normalized) return [];
  if (normalized.length <= EMBEDDING_CHUNK_SIZE) return [normalized];

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length && chunks.length < MAX_EMBEDDING_CHUNKS) {
    const end = Math.min(normalized.length, cursor + EMBEDDING_CHUNK_SIZE);
    const window = normalized.slice(cursor, end).trim();
    if (window) chunks.push(window);
    if (end >= normalized.length) break;
    cursor = Math.max(end - EMBEDDING_CHUNK_OVERLAP, cursor + 1);
  }

  return chunks;
}

function vectorLiteral(vector: number[]): string {
  const values = vector.map((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "0";
    return Number(numeric.toFixed(8)).toString();
  });
  return `[${values.join(",")}]`;
}

async function resolveEmbeddingRuntime(
  appId: string,
  preferredEmbeddingModel?: string | null,
): Promise<KnowledgeSyncRuntime> {
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
  runtime: KnowledgeSyncRuntime;
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
  runtime: KnowledgeSyncRuntime;
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
  runtime: KnowledgeSyncRuntime,
  text: string,
  modelNameOverride?: string,
): Promise<{ embedding: number[] | null; modelName: string }> {
  const fallbackModel =
    normalizeEmbeddingModel(modelNameOverride) ||
    normalizeEmbeddingModel(runtime.embeddingModelName) ||
    DEFAULT_EMBEDDING_MODEL;
  if (!runtime.baseUrl || !runtime.apiKey) {
    return {
      embedding: null,
      modelName: fallbackModel,
    };
  }

  const requestedModel =
    normalizeEmbeddingModel(modelNameOverride) ||
    normalizeEmbeddingModel(runtime.embeddingModelName) ||
    fallbackModel;

  const isAzure =
    (runtime.provider || "").toLowerCase() === "azure" ||
    runtime.baseUrl.includes(".openai.azure.com");

  if (isAzure) {
    const primary = await requestAzureEmbeddingWithModel({
      runtime,
      modelName: requestedModel,
      text,
    });
    if (primary.embedding) {
      return {
        embedding: primary.embedding,
        modelName: requestedModel,
      };
    }

    if (
      primary.errorCode === "unavailable_model" &&
      requestedModel !== "text-embedding-ada-002"
    ) {
      const fallbackModel = "text-embedding-ada-002";
      const fallback = await requestAzureEmbeddingWithModel({
        runtime,
        modelName: fallbackModel,
        text,
      });
      if (fallback.embedding) {
        return {
          embedding: fallback.embedding,
          modelName: fallbackModel,
        };
      }
    }

    const deployment = runtime.deploymentName || requestedModel;
    const legacy = await requestAzureEmbeddingWithDeployment({
      runtime,
      deploymentName: deployment,
      text,
    });
    return {
      embedding: legacy,
      modelName: requestedModel,
    };
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
  if (!response.ok) {
    return {
      embedding: null,
      modelName: requestedModel,
    };
  }
  const payload = await response.json().catch(() => null);
  return {
    embedding: extractEmbedding(payload),
    modelName: requestedModel,
  };
}

async function buildEmbeddingChunks(
  appId: string,
  text: string,
  preferredEmbeddingModel?: string | null,
): Promise<{
  embeddingModelName: string;
  chunks: EmbeddingChunk[];
}> {
  const runtime = await resolveEmbeddingRuntime(appId, preferredEmbeddingModel);
  if (!runtime.baseUrl || !runtime.apiKey) {
    throw new Error("Embedding runtime is not configured");
  }

  const chunks = splitIntoChunks(text);
  if (chunks.length === 0) {
    return {
      embeddingModelName: runtime.embeddingModelName,
      chunks: [],
    };
  }

  const result: EmbeddingChunk[] = [];
  let resolvedEmbeddingModelName = runtime.embeddingModelName;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const generated = await generateEmbedding(
      runtime,
      chunk,
      resolvedEmbeddingModelName,
    );
    if (generated.modelName && generated.modelName !== resolvedEmbeddingModelName) {
      resolvedEmbeddingModelName = generated.modelName;
    }
    const rawEmbedding = generated.embedding;
    const embedding =
      rawEmbedding && rawEmbedding.length === 1536 ? rawEmbedding : null;
    result.push({
      index,
      content: chunk,
      embedding,
      embeddingDimension: embedding ? embedding.length : null,
      chunkHash: crypto.createHash("sha256").update(chunk).digest("hex"),
      charCount: chunk.length,
      tokenCount: estimateTokenCount(chunk),
      locatorLabel: `sec.${index + 1}`,
      locatorJson: {
        type: "text",
        section: index + 1,
      },
    });
  }
  return {
    embeddingModelName: resolvedEmbeddingModelName,
    chunks: result,
  };
}

async function replaceSourceEmbeddings(params: {
  sourceId: string;
  chunks: EmbeddingChunk[];
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.embeddings.deleteMany({ where: { source_id: params.sourceId } });

    for (const chunk of params.chunks) {
      if (!chunk.embedding || chunk.embedding.length === 0) continue;
      await tx.$executeRaw`
				INSERT INTO "embeddings" ("id", "source_id", "faq_id", "content_chunk", "chunk_index", "embedding", "created_at")
				VALUES (gen_random_uuid(), ${params.sourceId}::uuid, NULL, ${chunk.content}, ${chunk.index}, ${vectorLiteral(chunk.embedding)}::vector, NOW())
			`;
    }
  });
}

async function replaceSourceKnowledgeChunks(params: {
  appId: string;
  chatbotId: string | null;
  sourceId: string;
  fileId: string | null;
  sourceVersion: number;
  embeddingModelName: string;
  chunks: EmbeddingChunk[];
}): Promise<void> {
  await prisma.$executeRawUnsafe(
    `DELETE FROM "knowledge_chunks" WHERE "source_id" = $1::uuid`,
    params.sourceId,
  );

  for (const chunk of params.chunks) {
    await prisma.$executeRawUnsafe(
      `
				INSERT INTO "knowledge_chunks" (
					"id", "app_id", "chatbot_id", "source_id", "file_id", "source_version", "chunk_index", "chunk_text",
					"chunk_hash", "char_count", "token_count", "locator_label", "locator_json", "embedding_model",
					"embedding_dimension", "embedding", "created_at", "updated_at"
				)
				VALUES (
					gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7,
					$8, $9, $10, $11, $12::jsonb, $13,
					$14, $15::vector, NOW(), NOW()
				)
			`,
      params.appId,
      params.chatbotId,
      params.sourceId,
      params.fileId,
      params.sourceVersion,
      chunk.index,
      chunk.content,
      chunk.chunkHash,
      chunk.charCount,
      chunk.tokenCount,
      chunk.locatorLabel,
      JSON.stringify(chunk.locatorJson),
      params.embeddingModelName,
      chunk.embeddingDimension,
      chunk.embedding ? vectorLiteral(chunk.embedding) : null,
    );
  }
}

async function replaceFaqEmbeddings(params: {
  faqId: string;
  chunks: EmbeddingChunk[];
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.embeddings.deleteMany({ where: { faq_id: params.faqId } });

    for (const chunk of params.chunks) {
      if (!chunk.embedding || chunk.embedding.length === 0) continue;
      await tx.$executeRaw`
				INSERT INTO "embeddings" ("id", "source_id", "faq_id", "content_chunk", "chunk_index", "embedding", "created_at")
				VALUES (gen_random_uuid(), NULL, ${params.faqId}::uuid, ${chunk.content}, ${chunk.index}, ${vectorLiteral(chunk.embedding)}::vector, NOW())
			`;
    }
  });
}

async function deleteSourceEmbeddings(sourceId: string): Promise<void> {
  await prisma.embeddings.deleteMany({ where: { source_id: sourceId } });
}

async function deleteFaqEmbeddings(faqId: string): Promise<void> {
  await prisma.embeddings.deleteMany({ where: { faq_id: faqId } });
}

async function deleteSourceKnowledgeChunks(sourceId: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `DELETE FROM "knowledge_chunks" WHERE "source_id" = $1::uuid`,
    sourceId,
  );
}

async function invalidateRetrievalCache(appId: string): Promise<void> {
  const pattern = `${RETRIEVAL_CACHE_PREFIX}${appId}:*`;
  let cursor = "0";
  try {
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== "0");
  } catch (error) {
    console.warn(
      "[KnowledgeIndexService] Retrieval cache invalidation skipped",
      {
        appId,
        error,
      },
    );
  }
}

async function ensureSourceFile(args: {
  appId: string;
  chatbotId: string | null;
  sourceId: string;
  title: string | null;
  fileName: string | null;
  fileType: string | null;
  fileSize: number | null;
  sourceUrl: string | null;
  sourceType: string | null;
  format: string | null;
}): Promise<string | null> {
  type ExistingFile = { id: string };
  const existing = await prisma.$queryRawUnsafe<ExistingFile[]>(
    `
			SELECT "id"
			FROM "knowledge_source_files"
			WHERE "source_id" = $1::uuid
			  AND COALESCE("is_active", true) = true
			ORDER BY "created_at" ASC
			LIMIT 1
		`,
    args.sourceId,
  );
  if (existing[0]?.id) return existing[0].id;

  type InsertedFile = { id: string };
  const inserted = await prisma.$queryRawUnsafe<InsertedFile[]>(
    `
			INSERT INTO "knowledge_source_files" (
				"id", "app_id", "chatbot_id", "source_id", "file_name", "mime_type", "file_size_bytes",
				"storage_url", "extraction_metadata", "status", "is_active", "created_at", "updated_at"
			)
			VALUES (
				gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
				$7, $8::jsonb, 'pending', true, NOW(), NOW()
			)
			RETURNING "id"
		`,
    args.appId,
    args.chatbotId,
    args.sourceId,
    args.fileName || args.title || "knowledge-source",
    args.fileType,
    args.fileSize || 0,
    args.sourceUrl,
    JSON.stringify({
      synthetic: true,
      source_type: args.sourceType,
      format: args.format,
    }),
  );
  return inserted[0]?.id || null;
}

async function getSourceFileSnapshot(args: {
  sourceId: string;
  fileId: string | null;
}): Promise<{
  id: string | null;
  fileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  storageUrl: string | null;
  storageKey: string | null;
} | null> {
  type SourceFileRow = {
    id: string;
    file_name: string | null;
    mime_type: string | null;
    file_size_bytes: number | null;
    storage_url: string | null;
    storage_key: string | null;
  };

  const rows = await prisma.$queryRawUnsafe<SourceFileRow[]>(
    `
			SELECT
				"id",
				"file_name",
				"mime_type",
				"file_size_bytes",
				"storage_url",
				"storage_key"
			FROM "knowledge_source_files"
			WHERE "source_id" = $1::uuid
			  AND ($2::uuid IS NULL OR "id" = $2::uuid)
			  AND COALESCE("is_active", true) = true
			ORDER BY CASE WHEN $2::uuid IS NOT NULL AND "id" = $2::uuid THEN 0 ELSE 1 END, "created_at" ASC
			LIMIT 1
		`,
    args.sourceId,
    args.fileId,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id || null,
    fileName: normalizeString(row.file_name),
    mimeType: normalizeString(row.mime_type),
    fileSizeBytes: Number.isFinite(Number(row.file_size_bytes))
      ? Number(row.file_size_bytes)
      : null,
    storageUrl: normalizeString(row.storage_url),
    storageKey: normalizeString(row.storage_key),
  };
}

async function createIngestionJob(args: {
  appId: string;
  chatbotId: string | null;
  sourceId: string;
  action: string;
  stage: string;
  status: string;
  payload?: Record<string, unknown>;
}): Promise<string | null> {
  type InsertedJob = { id: string };
  const rows = await prisma.$queryRawUnsafe<InsertedJob[]>(
    `
			INSERT INTO "knowledge_ingestion_jobs" (
				"id", "app_id", "chatbot_id", "source_id", "trigger", "stage", "status", "attempts",
				"started_at", "payload", "created_at", "updated_at"
			)
			VALUES (
				gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, 'indexer', $4, $5, 1,
				NOW(), $6::jsonb, NOW(), NOW()
			)
			RETURNING "id"
		`,
    args.appId,
    args.chatbotId,
    args.sourceId,
    args.stage,
    args.status,
    JSON.stringify({ action: args.action, ...(args.payload || {}) }),
  );
  return rows[0]?.id || null;
}

async function updateIngestionJob(args: {
  jobId: string | null;
  stage: string;
  status: string;
  errorMessage?: string | null;
  finished?: boolean;
}) {
  if (!args.jobId) return;
  await prisma.$executeRawUnsafe(
    `
			UPDATE "knowledge_ingestion_jobs"
			SET
				"stage" = $2,
				"status" = $3,
				"error_message" = $4,
				"finished_at" = CASE WHEN $5::boolean THEN NOW() ELSE "finished_at" END,
				"updated_at" = NOW()
			WHERE "id" = $1::uuid
		`,
    args.jobId,
    args.stage,
    args.status,
    args.errorMessage || null,
    Boolean(args.finished),
  );
}

async function syncSource(payload: KnowledgeChangeEventPayload): Promise<void> {
  type SourceRow = {
    id: string;
    title: string | null;
    content: string | null;
    metadata: unknown;
    is_active: boolean | null;
    active_version: number | null;
    file_name: string | null;
    file_type: string | null;
    file_size: number | null;
    source_url: string | null;
    source_type: string | null;
    format: string | null;
    embedding_model: string | null;
  };
  const sourceRows = await prisma.$queryRawUnsafe<SourceRow[]>(
    `
			SELECT
				"id", "title", "content", "metadata", "is_active", "active_version",
				"file_name", "file_type", "file_size", "source_url", "source_type", "format", "embedding_model"
			FROM "knowledge_sources"
			WHERE "id" = $1::uuid
			  AND "app_id" = $2::uuid
			LIMIT 1
		`,
    payload.knowledge_id,
    payload.app_id,
  );
  const source = sourceRows[0];
  if (!source || source.is_active === false) {
    await deleteSourceEmbeddings(payload.knowledge_id);
    await deleteSourceKnowledgeChunks(payload.knowledge_id);
    await invalidateRetrievalCache(payload.app_id);
    return;
  }

  let ingestionJobId: string | null = null;
  let mergedMetadata = toRecord(source.metadata);

  await prisma.$executeRawUnsafe(
    `
			UPDATE "knowledge_sources"
			SET "status" = 'extracting', "error_message" = NULL, "updated_at" = NOW()
			WHERE "id" = $1::uuid
		`,
    source.id,
  );
  ingestionJobId = await createIngestionJob({
    appId: payload.app_id,
    chatbotId: null,
    sourceId: source.id,
    action: payload.action,
    stage: "extracting",
    status: "running",
  });

  const fileId = await ensureSourceFile({
    appId: payload.app_id,
    chatbotId: null,
    sourceId: source.id,
    title: source.title,
    fileName: source.file_name,
    fileType: source.file_type,
    fileSize: source.file_size,
    sourceUrl: source.source_url,
    sourceType: source.source_type,
    format: source.format,
  });

  try {
    if (fileId) {
      await prisma.$executeRawUnsafe(
        `
					UPDATE "knowledge_source_files"
					SET
						"status" = 'extracting',
						"error_message" = NULL,
						"updated_at" = NOW()
					WHERE "id" = $1::uuid
				`,
        fileId,
      );
    }

    const sourceFile = await getSourceFileSnapshot({
      sourceId: source.id,
      fileId,
    });

    const extraction = await KnowledgeExtractionService.extractSourceContent({
      appId: payload.app_id,
      title: source.title,
      sourceType: source.source_type,
      format: source.format,
      sourceUrl: source.source_url,
      existingContent: source.content,
      file: sourceFile
        ? {
            id: sourceFile.id,
            fileName: sourceFile.fileName,
            mimeType: sourceFile.mimeType,
            fileSizeBytes: sourceFile.fileSizeBytes,
            storageUrl: sourceFile.storageUrl,
            storageKey: sourceFile.storageKey,
          }
        : null,
    });
    const extractedContent = [source.title || "", extraction.content || ""]
      .join("\n")
      .trim();
    if (!extractedContent) {
      throw new Error("Extraction produced empty content");
    }

    if (fileId) {
      await prisma.$executeRawUnsafe(
        `
					UPDATE "knowledge_source_files"
					SET
						"extraction_metadata" = $2::jsonb,
						"page_count" = $3,
						"duration_ms" = $4,
						"language" = $5,
						"status" = 'chunking',
						"error_message" = NULL,
						"updated_at" = NOW()
					WHERE "id" = $1::uuid
				`,
        fileId,
        JSON.stringify(extraction.metadata || {}),
        extraction.pageCount,
        extraction.durationMs,
        extraction.language,
      );
    }

    await updateIngestionJob({
      jobId: ingestionJobId,
      stage: "chunking",
      status: "running",
    });
    await prisma.$executeRawUnsafe(
      `UPDATE "knowledge_sources" SET "status" = 'chunking', "updated_at" = NOW() WHERE "id" = $1::uuid`,
      source.id,
    );

    const { chunks, embeddingModelName } = await buildEmbeddingChunks(
      payload.app_id,
      extractedContent,
      source.embedding_model,
    );

    await updateIngestionJob({
      jobId: ingestionJobId,
      stage: "embedding",
      status: "running",
    });
    await prisma.$executeRawUnsafe(
      `UPDATE "knowledge_sources" SET "status" = 'embedding', "updated_at" = NOW() WHERE "id" = $1::uuid`,
      source.id,
    );

    const sourceVersion = Math.max(1, Number(source.active_version || 0) + 1);

    await replaceSourceKnowledgeChunks({
      appId: payload.app_id,
      chatbotId: null,
      sourceId: source.id,
      fileId,
      sourceVersion,
      embeddingModelName,
      chunks,
    });

    await replaceSourceEmbeddings({
      sourceId: source.id,
      chunks,
    });

    const indexSizeBytes = chunks.reduce((sum, chunk) => {
      return (
        sum +
        Buffer.byteLength(chunk.content, "utf8") +
        (chunk.embedding ? chunk.embedding.length * 4 : 0)
      );
    }, 0);

    await prisma.$executeRawUnsafe(
      `
				UPDATE "knowledge_sources"
				SET
					"content" = $2,
					"chunk_count" = $3,
					"status" = 'ready',
					"error_message" = NULL,
					"last_synced_at" = NOW(),
					"metadata" = $4::jsonb,
					"updated_at" = NOW(),
					"active_version" = $5,
					"embedding_model" = $6,
					"embedding_dimension" = 1536,
					"index_size_bytes" = $7
				WHERE "id" = $1::uuid
			`,
      source.id,
      extraction.content,
      chunks.length,
      JSON.stringify(mergedMetadata),
      sourceVersion,
      embeddingModelName,
      indexSizeBytes,
    );

    if (fileId) {
      await prisma.$executeRawUnsafe(
        `
					UPDATE "knowledge_source_files"
					SET
						"status" = 'ready',
						"error_message" = NULL,
						"extracted_at" = NOW(),
						"updated_at" = NOW()
					WHERE "id" = $1::uuid
				`,
        fileId,
      );
    }

    await updateIngestionJob({
      jobId: ingestionJobId,
      stage: "completed",
      status: "completed",
      finished: true,
    });
    await invalidateRetrievalCache(payload.app_id);
  } catch (error) {
    await prisma.$executeRawUnsafe(
      `
				UPDATE "knowledge_sources"
				SET
					"status" = 'failed',
					"error_message" = $2,
					"metadata" = $3::jsonb,
					"updated_at" = NOW()
				WHERE "id" = $1::uuid
			`,
      source.id,
      error instanceof Error ? error.message : "Failed to sync knowledge index",
      JSON.stringify(mergedMetadata),
    );
    await updateIngestionJob({
      jobId: ingestionJobId,
      stage: "failed",
      status: "failed",
      errorMessage:
        error instanceof Error
          ? error.message
          : "Failed to sync knowledge index",
      finished: true,
    });
    if (fileId) {
      await prisma.$executeRawUnsafe(
        `
					UPDATE "knowledge_source_files"
					SET
						"status" = 'failed',
						"error_message" = $2,
						"updated_at" = NOW()
					WHERE "id" = $1::uuid
				`,
        fileId,
        error instanceof Error
          ? error.message
          : "Failed to sync knowledge index",
      );
    }
    throw error;
  }
}

async function syncFaq(payload: KnowledgeChangeEventPayload): Promise<void> {
  const faq = await prisma.knowledge_faqs.findFirst({
    where: {
      id: payload.knowledge_id,
      app_id: payload.app_id,
    },
    select: {
      id: true,
      question: true,
      answer: true,
      is_active: true,
    },
  });

  if (!faq || faq.is_active === false) {
    await deleteFaqEmbeddings(payload.knowledge_id);
    await invalidateRetrievalCache(payload.app_id);
    return;
  }

  const faqText = `${faq.question || ""}\n${faq.answer || ""}`.trim();
  const { chunks } = await buildEmbeddingChunks(payload.app_id, faqText);

  await replaceFaqEmbeddings({
    faqId: faq.id,
    chunks,
  });
  await invalidateRetrievalCache(payload.app_id);
}

async function purgeSource(
  payload: KnowledgeChangeEventPayload,
): Promise<void> {
  await deleteSourceEmbeddings(payload.knowledge_id);
  await deleteSourceKnowledgeChunks(payload.knowledge_id);
  await prisma.$executeRawUnsafe(
    `
			UPDATE "knowledge_sources"
			SET
				"chunk_count" = 0,
				"status" = CASE
					WHEN COALESCE("is_active", true) = false THEN 'archived'
					ELSE 'ready'
				END,
				"error_message" = NULL,
				"index_size_bytes" = 0,
				"last_synced_at" = NOW(),
				"updated_at" = NOW()
			WHERE "id" = $1::uuid
			  AND "app_id" = $2::uuid
		`,
    payload.knowledge_id,
    payload.app_id,
  );
  await invalidateRetrievalCache(payload.app_id);
}

async function purgeFaq(payload: KnowledgeChangeEventPayload): Promise<void> {
  await deleteFaqEmbeddings(payload.knowledge_id);
  await invalidateRetrievalCache(payload.app_id);
}

export abstract class KnowledgeIndexService {
  static async enqueueKnowledgeChangeEvent(
    payload: KnowledgeChangeEventPayload,
  ): Promise<void> {
    await maintenanceQueue.add(KNOWLEDGE_CHANGE_EVENT_JOB, payload, {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 2_000,
      },
      removeOnComplete: 1_000,
      removeOnFail: 2_000,
    });
  }

  static async handleKnowledgeChangeEventJob(
    rawPayload: unknown,
  ): Promise<void> {
    const payload = normalizePayload(rawPayload);
    if (payload.action === "delete") {
      await maintenanceQueue.add(KNOWLEDGE_PURGE_JOB, payload, {
        attempts: 5,
        backoff: { type: "exponential", delay: 2_000 },
        removeOnComplete: 1_000,
        removeOnFail: 2_000,
      });
      return;
    }

    await maintenanceQueue.add(KNOWLEDGE_SYNC_JOB, payload, {
      attempts: 5,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: 1_000,
      removeOnFail: 2_000,
    });
  }

  static async syncKnowledgeIndexJob(rawPayload: unknown): Promise<void> {
    const payload = normalizePayload(rawPayload);
    if (payload.entity === "faq") {
      await syncFaq(payload);
      return;
    }
    await syncSource(payload);
  }

  static async purgeKnowledgeIndexJob(rawPayload: unknown): Promise<void> {
    const payload = normalizePayload(rawPayload);
    if (payload.entity === "faq") {
      await purgeFaq(payload);
      return;
    }
    await purgeSource(payload);
  }
}
