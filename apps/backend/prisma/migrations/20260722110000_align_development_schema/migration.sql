-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "company_id" UUID,
ADD COLUMN     "owner_id" UUID,
ADD COLUMN     "pipeline_stage_id" UUID,
ADD COLUMN     "team_id" UUID;

-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "deal_threshold" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "whatsapp_lead_registrations" ADD COLUMN     "ai_handling_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "handoff_note" TEXT,
ADD COLUMN     "released_at" TIMESTAMPTZ(6),
ADD COLUMN     "takeover_at" TIMESTAMPTZ(6),
ADD COLUMN     "takeover_by" UUID,
ADD COLUMN     "takeover_reason" TEXT,
ADD COLUMN     "takeover_source" VARCHAR(20);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "app_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "norm_name" VARCHAR(255) NOT NULL,
    "city" VARCHAR(120),
    "website" VARCHAR(255),
    "notes" TEXT,
    "type" VARCHAR(20) NOT NULL DEFAULT 'perusahaan',
    "industry" VARCHAR(40),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6),
    "deleted_at" TIMESTAMP(6),

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_activity_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "actor_id" UUID,
    "target_id" UUID,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "app_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT,
    "conversation_id" UUID,
    "task_id" UUID,
    "dedup_key" VARCHAR(200) NOT NULL,
    "metadata" JSONB DEFAULT '{}',
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "app_id" UUID NOT NULL,
    "contact_id" UUID,
    "owner_id" UUID,
    "team_id" UUID,
    "name" VARCHAR(255) NOT NULL,
    "product" VARCHAR(120),
    "value" DECIMAL(16,2),
    "currency" VARCHAR(8) NOT NULL DEFAULT 'IDR',
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "stage" VARCHAR(60),
    "probability" INTEGER NOT NULL DEFAULT 10,
    "source" VARCHAR(40) NOT NULL DEFAULT 'manual',
    "notes" TEXT,
    "created_by" UUID,
    "closed_at" TIMESTAMPTZ(6),
    "stage_changed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sakti_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "app_id" UUID NOT NULL,
    "customer_name" VARCHAR(255) NOT NULL,
    "company" VARCHAR(255),
    "product" VARCHAR(120),
    "vendor" VARCHAR(255),
    "license_no" VARCHAR(120),
    "purchased_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "source" VARCHAR(40) NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sakti_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surat_sakti" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "app_id" UUID NOT NULL,
    "contact_id" UUID,
    "opportunity_id" UUID,
    "sakti_record_id" UUID,
    "customer_name" VARCHAR(255) NOT NULL,
    "company" VARCHAR(255),
    "product" VARCHAR(120),
    "from_vendor" VARCHAR(255),
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "our_approved" BOOLEAN NOT NULL DEFAULT false,
    "their_approved" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "template" VARCHAR(60),
    "template_values" JSONB,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "surat_sakti_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "app_id" UUID NOT NULL,
    "created_by" UUID,
    "source" VARCHAR(20) NOT NULL DEFAULT 'csv',
    "filename" VARCHAR(255),
    "status" VARCHAR(20) NOT NULL DEFAULT 'preview',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "tasks_created" INTEGER NOT NULL DEFAULT 0,
    "error_log" JSONB DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_job_rows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "mapped" JSONB NOT NULL DEFAULT '{}',
    "resolved_assignee_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ok',
    "messages" JSONB DEFAULT '[]',
    "contact_id" UUID,
    "task_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "import_job_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "app_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "product_skills" JSONB NOT NULL DEFAULT '[]',
    "segments" JSONB NOT NULL DEFAULT '[]',
    "level" VARCHAR(20),
    "max_active" INTEGER NOT NULL DEFAULT 20,
    "work_hours" JSONB,
    "regions" JSONB NOT NULL DEFAULT '[]',
    "languages" JSONB NOT NULL DEFAULT '[]',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "persona" TEXT,
    "experience_years" INTEGER,
    "phone" VARCHAR(40),
    "position" VARCHAR(120),
    "joined_at" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sales_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_companies_app_name" ON "companies"("app_id", "name");

-- CreateIndex
CREATE INDEX "idx_companies_app_type" ON "companies"("app_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "uq_companies_app_norm_name" ON "companies"("app_id", "norm_name");

-- CreateIndex
CREATE INDEX "idx_company_activity_company" ON "company_activity_log"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_notifications_user_unread" ON "notifications"("app_id", "user_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedup_key" ON "notifications"("app_id", "user_id", "dedup_key");

-- CreateIndex
CREATE INDEX "idx_opportunities_app_status" ON "opportunities"("app_id", "status");

-- CreateIndex
CREATE INDEX "idx_opportunities_owner" ON "opportunities"("app_id", "owner_id");

-- CreateIndex
CREATE INDEX "idx_opportunities_contact" ON "opportunities"("contact_id");

-- CreateIndex
CREATE INDEX "idx_sakti_records_app" ON "sakti_records"("app_id");

-- CreateIndex
CREATE INDEX "idx_surat_sakti_app_status" ON "surat_sakti"("app_id", "status");

-- CreateIndex
CREATE INDEX "idx_surat_sakti_contact" ON "surat_sakti"("contact_id");

-- CreateIndex
CREATE INDEX "idx_import_jobs_app_creator" ON "import_jobs"("app_id", "created_by", "created_at");

-- CreateIndex
CREATE INDEX "idx_import_job_rows_job" ON "import_job_rows"("job_id", "row_number");

-- CreateIndex
CREATE INDEX "idx_sales_profiles_app" ON "sales_profiles"("app_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_profiles_app_user_key" ON "sales_profiles"("app_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_contacts_app_owner" ON "contacts"("app_id", "owner_id");

-- CreateIndex
CREATE INDEX "idx_contacts_app_team" ON "contacts"("app_id", "team_id");

-- CreateIndex
CREATE INDEX "idx_contacts_app_company" ON "contacts"("app_id", "company_id");

-- CreateIndex
CREATE INDEX "idx_contacts_app_stage" ON "contacts"("app_id", "pipeline_stage_id");

-- CreateIndex
CREATE INDEX "idx_whatsapp_lead_registrations_takeover" ON "whatsapp_lead_registrations"("app_id", "ai_handling_enabled", "updated_at");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
