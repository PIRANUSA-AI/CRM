import { createHash } from "crypto";
import { Elysia, t } from "elysia";
import { KnowledgeService } from "./service";
import { KnowledgeRequestModel } from "./model";
import { appContext } from "../../plugins";
import { MediaService } from "../media/service";

const SourceFileModel = t.Object({
  file_name: t.String(),
  mime_type: t.Optional(t.String()),
  file_size_bytes: t.Optional(t.Number()),
  checksum_sha256: t.Optional(t.String()),
  storage_key: t.Optional(t.String()),
  storage_url: t.Optional(t.String()),
  language: t.Optional(t.String()),
  page_count: t.Optional(t.Number()),
  duration_ms: t.Optional(t.Number()),
  extraction_metadata: t.Optional(t.Any()),
});

const SourceCreateModel = t.Object({
  title: t.String(),
  content: t.Optional(t.String()),
  type: t.Optional(t.String()),
  format: t.Optional(t.String()),
  embedding_model: t.Optional(t.String()),
  metadata: t.Optional(t.Any()),
  source_type: t.Optional(t.String()),
  source_url: t.Optional(t.String()),
  file_name: t.Optional(t.String()),
  file_size: t.Optional(t.Number()),
  file_type: t.Optional(t.String()),
  category_id: t.Optional(t.String()),
  files: t.Optional(t.Array(SourceFileModel)),
});

const SourceUpdateModel = t.Partial(SourceCreateModel);

function resolveUploadKnowledgeFormat(
  fileName: string,
  mimeType: string,
): {
  type: string;
  format: string;
} {
  const name = String(fileName || "").toLowerCase();
  const mime = String(mimeType || "").toLowerCase();

  if (mime.includes("pdf") || name.endsWith(".pdf")) {
    return { type: "pdf", format: "pdf" };
  }
  if (
    mime.includes("markdown") ||
    name.endsWith(".md") ||
    name.endsWith(".markdown")
  ) {
    return { type: "markdown", format: "markdown" };
  }
  if (
    mime.includes("wordprocessingml") ||
    mime.includes("msword") ||
    name.endsWith(".docx") ||
    name.endsWith(".doc")
  ) {
    return { type: "docx", format: "docx" };
  }
  if (mime.startsWith("image/")) {
    return { type: "image", format: "image" };
  }
  if (mime.startsWith("audio/")) {
    return { type: "audio", format: "audio" };
  }
  return { type: "text", format: "text" };
}

async function resolveUploadKnowledgeContent(
  file: File,
  format: string,
): Promise<string> {
  try {
    const fileName = String(file.name || "").toLowerCase();
    const mime = String(file.type || "").toLowerCase();
    const isTextLike =
      format === "markdown" ||
      format === "text" ||
      mime.startsWith("text/") ||
      mime.includes("json") ||
      mime.includes("xml") ||
      fileName.endsWith(".txt") ||
      fileName.endsWith(".md") ||
      fileName.endsWith(".markdown") ||
      fileName.endsWith(".csv") ||
      fileName.endsWith(".json");

    if (!isTextLike) {
      return "";
    }

    const text = await file.text();
    const normalized = text.trim();
    if (!normalized) {
      return "";
    }
    return normalized.slice(0, 200_000);
  } catch {
    return "";
  }
}

function mapUploadConfigurationError(message: string): string | null {
  const normalized = String(message || "").toLowerCase();
  if (
    normalized.includes("public url") &&
    normalized.includes("not configured")
  ) {
    return "Konfigurasi Cloudflare R2 belum lengkap. Set `R2_PUBLIC_URL` (atau `S3_PUBLIC_URL`) di environment backend.";
  }
  if (
    normalized.includes("credentials") &&
    normalized.includes("not configured")
  ) {
    return "Kredensial Cloudflare R2 belum lengkap. Set `R2_ACCESS_KEY_ID` dan `R2_SECRET_ACCESS_KEY` di environment backend.";
  }
  return null;
}

export const knowledge = new Elysia({
  prefix: "/knowledge",
  tags: ["Knowledge"],
})
  .use(appContext)
  .get(
    "/",
    async ({ resolvedAppId, query, set }) => {
      if (!resolvedAppId) {
        set.status = 400;
        return { error: "App ID required" };
      }
      const sources = await KnowledgeService.listSources(resolvedAppId, {
        categoryId: query.categoryId,
        search: query.q,
        limit: query.limit ? Number(query.limit) : undefined,
      });
      return { success: true, payload: sources };
    },
    {
      query: t.Object({
        appId: t.Optional(t.String()),
        categoryId: t.Optional(t.String()),
        q: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/",
    async ({ resolvedAppId, body, set }) => {
      if (!resolvedAppId) {
        set.status = 400;
        return { error: "App ID required" };
      }
      const created = await KnowledgeService.createSource(resolvedAppId, body);
      return { success: true, data: created };
    },
    {
      body: SourceCreateModel,
    },
  )
  .post(
    "/query",
    async ({ resolvedAppId, body, set }) => {
      if (!resolvedAppId) {
        set.status = 400;
        return { error: "App ID required" };
      }
      const queryText = String(body.query || "").trim();
      if (!queryText) {
        set.status = 400;
        return { error: "query is required" };
      }
      const result = await KnowledgeService.retrievalTest(resolvedAppId, {
        query: queryText,
        selectedSourceIds: body.selectedSourceIds,
        topK: body.topK,
        modelId: body.modelId,
        provider: body.provider,
        channel: "test",
      });
      return {
        success: true,
        payload: {
          answer: result.answer,
          latency_ms: result.latencyMs,
          top_chunks: result.topChunks,
          grounded_sources: result.groundedSources,
          tokens: result.tokens,
          cost: result.cost,
          model_id: result.modelId,
          provider: result.provider,
          query_log_id: result.queryLogId,
        },
      };
    },
    {
      body: t.Object({
        query: t.String(),
        topK: t.Optional(t.Number()),
        selectedSourceIds: t.Optional(t.Array(t.String())),
        modelId: t.Optional(t.String()),
        provider: t.Optional(t.String()),
      }),
    },
  )

  // Categories
  .get(
    "/categories",
    async ({ resolvedAppId, set }) => {
      if (!resolvedAppId) {
        set.status = 400;
        return { error: "App ID required" };
      }
      const cats = await KnowledgeService.getCategories(resolvedAppId);
      return { success: true, payload: cats };
    },
    {
      query: t.Object({
        appId: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/categories",
    async ({ resolvedAppId, body, set }) => {
      if (!resolvedAppId) {
        set.status = 400;
        return { error: "App ID required" };
      }
      const cat = await KnowledgeService.createCategory(resolvedAppId, body);
      return { data: cat };
    },
    {
      body: KnowledgeRequestModel.createCategory,
    },
  )
  .delete(
    "/categories/:id",
    async ({ params, resolvedAppId, set }) => {
      if (!resolvedAppId) {
        set.status = 400;
        return { error: "App ID required" };
      }
      await KnowledgeService.deleteCategory(params.id, resolvedAppId);
      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
    },
  )

  // Sources
  .get(
    "/sources",
    async ({ resolvedAppId, query, set }) => {
      if (!resolvedAppId) {
        set.status = 400;
        return { error: "App ID required" };
      }
      const sources = await KnowledgeService.listSources(resolvedAppId, {
        categoryId: query.categoryId,
        search: query.q,
        limit: query.limit ? Number(query.limit) : undefined,
      });
      return { success: true, payload: sources };
    },
    {
      query: t.Object({
        appId: t.Optional(t.String()),
        categoryId: t.Optional(t.String()),
        q: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/sources/:id",
    async ({ params, resolvedAppId, set }) => {
      if (!resolvedAppId) {
        set.status = 400;
        return { error: "App ID required" };
      }
      const source = await KnowledgeService.getSource(params.id, resolvedAppId);
      if (!source) {
        set.status = 404;
        return { error: "Source not found" };
      }
      return { success: true, data: source };
    },
    {
      params: t.Object({ id: t.String() }),
    },
  )
  .post(
    "/sources",
    async ({ resolvedAppId, body, set }) => {
      if (!resolvedAppId) {
        set.status = 400;
        return { error: "App ID required" };
      }
      const source = await KnowledgeService.createSource(resolvedAppId, body);
      return { success: true, data: source };
    },
    {
      body: SourceCreateModel,
    },
  )
  .post(
    "/sources/upload",
    async ({ resolvedAppId, body, userId, set }) => {
      if (!resolvedAppId) {
        set.status = 400;
        return { error: "App ID required" };
      }

      const file = body.file as File;
      if (!file) {
        set.status = 400;
        return { error: "file is required" };
      }

      try {
        const mimeType = String(file.type || "application/octet-stream");
        const fileName = String(file.name || "knowledge-source");
        const embeddingModel = String(body.embeddingModel || "").trim();
        const upload = await MediaService.uploadFile(
          file,
          "knowledge",
          userId || "unknown",
          resolvedAppId,
        );
        const checksumSha256 =
          upload.checksumSha256 ||
          createHash("sha256")
            .update(Buffer.from(await file.arrayBuffer()))
            .digest("hex");
        const formatMeta = resolveUploadKnowledgeFormat(fileName, mimeType);
        const content = await resolveUploadKnowledgeContent(
          file,
          formatMeta.format,
        );
        const tags = Array.isArray(body.tags)
          ? body.tags.map((tag) => String(tag || "").trim()).filter(Boolean)
          : [];

        const source = await KnowledgeService.createSource(resolvedAppId, {
          title: String(body.title || "").trim() || fileName,
          content,
          type: formatMeta.type,
          format: formatMeta.format,
          embedding_model: embeddingModel || undefined,
          metadata: {
            tags,
            is_private: Boolean(body.isPrivate),
            storage_provider: "cloudflare-r2",
            storage_bucket:
              process.env.R2_BUCKET_NAME || process.env.S3_BUCKET || null,
            uploaded_via: "knowledge-source-upload",
            media_type: upload.type,
          },
          source_type: "file",
          source_url: upload.url,
          file_name: upload.fileName,
          file_size: upload.fileSize,
          file_type: upload.mimeType,
          files: [
            {
              file_name: upload.fileName,
              mime_type: upload.mimeType,
              file_size_bytes: upload.fileSize,
              checksum_sha256: checksumSha256,
              storage_key: upload.key,
              storage_url: upload.url,
              extraction_metadata: {
                upload_provider: "cloudflare-r2",
                upload_platform: "knowledge",
                media_type: upload.type,
              },
            },
          ],
        });

        return {
          success: true,
          data: {
            source,
            upload,
          },
        };
      } catch (error) {
        const rawMessage =
          error instanceof Error
            ? error.message
            : "Knowledge source upload failed";
        const mapped = mapUploadConfigurationError(rawMessage);
        set.status = mapped ? 400 : 500;
        return {
          error: mapped || rawMessage,
        };
      }
    },
    {
      body: t.Object({
        file: t.File(),
        embeddingModel: t.Optional(t.String()),
        title: t.Optional(t.String()),
        isPrivate: t.Optional(t.Boolean()),
        tags: t.Optional(t.Array(t.String())),
      }),
    },
  )
  .patch(
    "/sources/:id",
    async ({ params, resolvedAppId, body, set }) => {
      if (!resolvedAppId) {
        set.status = 400;
        return { error: "App ID required" };
      }
      const updated = await KnowledgeService.updateSource(
        params.id,
        resolvedAppId,
        body,
      );
      if (!updated) {
        set.status = 404;
        return { error: "Source not found" };
      }
      return { success: true, data: updated };
    },
    {
      params: t.Object({ id: t.String() }),
      body: SourceUpdateModel,
    },
  )
  .delete(
    "/sources/:id",
    async ({ params, resolvedAppId, set }) => {
      if (!resolvedAppId) {
        set.status = 400;
        return { error: "App ID required" };
      }
      const deleted = await KnowledgeService.archiveSource(
        params.id,
        resolvedAppId,
      );
      if (!deleted) {
        set.status = 404;
        return { error: "Source not found" };
      }
      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
    },
  )

  // Retrieval Test
  .post(
    "/retrieval/test",
    async ({ resolvedAppId, body, set }) => {
      if (!resolvedAppId) {
        set.status = 400;
        return { error: "App ID required" };
      }
      const result = await KnowledgeService.retrievalTest(resolvedAppId, {
        query: body.query,
        selectedSourceIds: body.selectedSourceIds,
        topK: body.topK,
        modelId: body.modelId,
        provider: body.provider,
        channel: "test",
      });
      return { success: true, payload: result };
    },
    {
      body: t.Object({
        query: t.String(),
        topK: t.Optional(t.Number()),
        selectedSourceIds: t.Optional(t.Array(t.String())),
        modelId: t.Optional(t.String()),
        provider: t.Optional(t.String()),
      }),
    },
  )

  // Analytics
  .get(
    "/analytics",
    async ({ resolvedAppId, query, set }) => {
      if (!resolvedAppId) {
        set.status = 400;
        return { error: "App ID required" };
      }
      const windowHours = query.window
        ? Number(String(query.window).replace(/[^\d]/g, ""))
        : undefined;
      const channel =
        query.channel === "test" || query.channel === "live"
          ? query.channel
          : "all";
      const analytics = await KnowledgeService.analytics(resolvedAppId, {
        windowHours,
        channel,
      });
      return { success: true, payload: analytics };
    },
    {
      query: t.Object({
        appId: t.Optional(t.String()),
        window: t.Optional(t.String()),
        channel: t.Optional(t.String()),
      }),
    },
  )

  // Backfill reindex trigger
  .post(
    "/reindex",
    async ({ resolvedAppId, set }) => {
      if (!resolvedAppId) {
        set.status = 400;
        return { error: "App ID required" };
      }
      const result =
        await KnowledgeService.enqueueReindexSources(resolvedAppId);
      return { success: true, payload: result };
    },
    {
      body: t.Optional(t.Object({})),
    },
  )

  // FAQs
  .get(
    "/faqs",
    async ({ resolvedAppId, query, set }) => {
      if (!resolvedAppId) {
        set.status = 400;
        return { error: "App ID required" };
      }
      const faqs = await KnowledgeService.getFAQs(resolvedAppId, {
        category_id: query.categoryId,
        search: query.q,
      });
      return { success: true, payload: faqs };
    },
    {
      query: t.Object({
        appId: t.Optional(t.String()),
        categoryId: t.Optional(t.String()),
        q: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/faqs",
    async ({ resolvedAppId, body, set }) => {
      if (!resolvedAppId) {
        set.status = 400;
        return { error: "App ID required" };
      }
      const faq = await KnowledgeService.createFAQ(resolvedAppId, body);
      return { data: faq };
    },
    {
      body: KnowledgeRequestModel.createFAQ,
    },
  )
  .patch(
    "/faqs/:id",
    async ({ params, resolvedAppId, body, set }) => {
      if (!resolvedAppId) {
        set.status = 400;
        return { error: "App ID required" };
      }
      const faq = await KnowledgeService.updateFAQ(
        params.id,
        resolvedAppId,
        body,
      );
      return { data: faq };
    },
    {
      params: t.Object({ id: t.String() }),
      body: KnowledgeRequestModel.updateFAQ,
    },
  )
  .delete(
    "/faqs/:id",
    async ({ params, resolvedAppId, set }) => {
      if (!resolvedAppId) {
        set.status = 400;
        return { error: "App ID required" };
      }
      await KnowledgeService.deleteFAQ(params.id, resolvedAppId);
      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
    },
  )

  // Stats
  .get(
    "/stats",
    async ({ resolvedAppId, set }) => {
      if (!resolvedAppId) {
        set.status = 400;
        return { error: "App ID required" };
      }
      const stats = await KnowledgeService.getStats(resolvedAppId);
      return { success: true, payload: stats };
    },
    {
      query: t.Object({ appId: t.Optional(t.String()) }),
    },
  );
