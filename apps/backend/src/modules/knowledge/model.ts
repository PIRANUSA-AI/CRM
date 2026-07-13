import { t } from "elysia";

export const KnowledgeModel = {
  category: t.Object({
    id: t.String(),
    name: t.String(),
    description: t.Nullable(t.String()),
    source_count: t.Optional(t.Number()),
    faq_count: t.Optional(t.Number()),
  }),

  faq: t.Object({
    id: t.String(),
    question: t.String(),
    answer: t.String(),
    category_id: t.Nullable(t.String()),
    is_active: t.Boolean(),
  }),

  stats: t.Object({
    sources_count: t.Number(),
    faqs_count: t.Number(),
    categories_count: t.Number(),
  }),
} as const;

export const KnowledgeRequestModel = {
  createCategory: t.Object({
    name: t.String(),
    description: t.Optional(t.String()),
    parent_id: t.Optional(t.String()),
  }),

  createFAQ: t.Object({
    question: t.String(),
    answer: t.String(),
    category_id: t.Optional(t.String()),
    priority: t.Optional(t.Number()),
  }),

  updateCategory: t.Partial(
    t.Object({
      name: t.String(),
      description: t.Optional(t.String()),
      parent_id: t.Optional(t.String()),
    }),
  ),

  updateFAQ: t.Partial(
    t.Object({
      question: t.String(),
      answer: t.String(),
      category_id: t.Optional(t.String()),
      priority: t.Optional(t.Number()),
      is_active: t.Boolean(),
    }),
  ),
} as const;
