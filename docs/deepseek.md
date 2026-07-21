# Task List CRM — Pemahaman & Strategi

## Ringkasan

Dokumen ini menjelaskan pemahaman menyeluruh tentang proyek CRM Piranusa dan strategi implementasi **Task List System** untuk role **Sales**, dengan referensi utama **HubSpot Task, Sequences, dan Workflow system**.

---

## Referensi Utama: HubSpot

Setelah mempelajari HubSpot secara mendalam, berikut pola-pola yang kita adopsi:

### HubSpot Tasks
- Task = to-do item **selalu terikat ke record** (contact/deal/company)
- 3 tipe: **Call** (munculin nomor telp), **Email** (buka compose), **To-do** (general)
- Task punya: title, type, due date, owner, priority, notes, associations
- Task Queue: grup task dikerjakan berurutan (conveyor belt)
- Bisa auto-created via Workflows (trigger → condition → action)

### HubSpot Sequences
- **Timed series** of emails + tasks untuk nurturing
- Dikirim dari **personal inbox** rep (bukan marketing email)
- **Auto-pause** saat contact reply atau booking meeting
- Bisa di-enroll manual atau via workflow
- Setiap step: email template atau task reminder

### HubSpot Workflows (untuk task)
- Trigger: form submission, deal stage change, property update, inactivity, date
- Action: Create task — with owner (dynamic), due date (relative), priority, queue
- Contoh pattern:
  - Stage-exit → create follow-up task
  - Inactivity 14 days → create re-engagement task
  - Form submission → create task for assigned SDR

### HubSpot Manager Oversight
- Sales workspace: lihat task due today / overdue / tomorrow
- Dashboard per team: filter by team/owner
- Sales Team Activity report: per-rep metrics (calls, emails, tasks completed)
- Task accountability: completion rate, time to complete, queue load

### HubSpot Data Import
- Import dari CSV/Excel/Google Sheets
- Bisa import: contacts, companies, deals, tasks, notes, calls
- Auto-mapping column headers ke CRM properties
- Deduplication by email

---

## Arsitektur CRM Saat Ini

```
Monorepo:
├── apps/backend/        # Elysia + Prisma + BullMQ + Socket.IO
├── apps/frontend/       # React + TanStack Router + Tailwind + shadcn
├── packages/shared/     # AI Agent config types
├── whatsapp-service/    # Baileys microservice (port 3012)
└── docs/

Tech: Bun | PostgreSQL (pgvector) | Redis | MinIO | LangChain + Ollama
Auth: Better Auth
Roles: sales | leader | ceo | superadmin
```

### Sales Role — Akses Saat Ini
`/dashboard` | `/chat` | `/handover` | `/customers` | `/settings` | `/help`

### Existing AI Integration
- Personal AI Reply (Ollama → review → draft → send WA)
- Chatbot (knowledge base + RAG + follow-up)
- AI Playground (A/B testing, routing strategy)
- AI Suggestions (saran balasan di percakapan)

---

## Visi: Task List System — Full Scope

### Sumber Task (Multi-source)

```
                    ┌──────────────────┐
                    │  WHATSAPP CHAT   │ ← Existing: Baileys → Webhook → DB
                    │  (Inbound Msg)   │   [NEW] + AI Task Analysis
                    └────────┬─────────┘
                             │
                    ┌──────────────────┐
                    │     EMAIL        │ ← [NEW] Inbound email → parsing → task
                    │  (Inbound/Out)   │   [NEW] Outbound: one-click reply / auto-send
                    └────────┬─────────┘
                             │
                    ┌──────────────────┐
                    │  GOOGLE SHEETS   │ ← [NEW] Import migration → create contacts + tasks
                    │  (Data Migrate)  │   [NEW] One-time / recurring sync
                    └────────┬─────────┘
                             │
                    ┌──────────────────┐
                    │     MANUAL       │ ← [NEW] Sales/Leader create task manually
                    │  (User Created)  │   Via task list page / chat page / customer page
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │   AI ANALYZER    │ ← Klasifikasi: task type, priority, due, assignee
                    │  (LangChain +    │   Auto-create task + recommended reply content
                    │   Ollama)        │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │   SALES TASKS    │ ← Queue: pending → in_progress → completed
                    │   + SEQUENCES    │   Sequences: timed auto follow-up steps
                    └──────────────────┘
```

---

### 1. Sumber Task #1 — WhatsApp Chat (Existing + AI)

**Alur:**

```
WA message masuk via Baileys
  → WebhookService.handleWhatsAppInbound()
    → Parse, save message + conversation + contact
    → [EXISTING] PersonalAiReplyService (AI reply)
    → [NEW] TaskAnalysisQueue.add({ messageId, source: 'whatsapp' })
      → Worker: TaskAnalysisService.analyze()
        → Ambil message + context (last 5 messages + contact info)
        → Panggil Ollama dengan structured output
        → Output: { isActionable, taskType, priority, title, description, 
                     suggestedReply, dueInMinutes, confidence }
        → Jika actionable: create task + emit Socket.IO
```

**Task Type Mapping:**

| Pesan Customer | Task Type | Priority | Suggested Reply |
|---|---|---|---|
| "Halo, mau tanya produk A" | `chat` | medium | "Tentu, produk A adalah... Apakah ada yang ingin ditanyakan?" |
| "Harganya berapa?" | `chat` | high | "Harganya Rp X. Apakah berminat untuk order?" |
| "Saya mau order" | `chat` | urgent | "Baik, akan saya bantu proses order. Silakan isi data..." |
| "Nanti saya kabari ya" | `follow_up` | low | (reminder: follow up in 3 days) |
| (First message, new contact) | `follow_up` | medium | "Halo, ada yang bisa dibantu?" |
| No activity 7 days | `follow_up` | medium | "Halo, bagaimana dengan penawaran kami sebelumnya?" |

---

### 2. Sumber Task #2 — Email

**Konsep:**
- CRM menerima email inbound (forward / API / IMAP)
- Email diproses → create conversation + contact (mirip WA)
- AI analyze email content → create task
- Sales bisa reply via CRM → terkirim sebagai email dari inbox sales
- Email templates untuk quick reply

**Alur Inbound Email:**

```
Email masuk ke alamat sales@domain.com
  → [NEW] Email Service (IMAP / API webhook / forward)
    → Parse: from, to, subject, body, attachments
    → Find/create contact by email
    → Create conversation (channel_type: 'email')
    → Save message
    → [SAME] TaskAnalysisQueue.add({ messageId, source: 'email' })
      → AI analyze → create task
```

**Alur Outbound Email (dari task):**

```
Sales buka task type 'email'
  → Lihat recommended reply dari AI (atau tulis manual)
  → Klik "Send" → Email terkirim dari inbox sales
  → Task marked complete
  → Atau: set reminder → auto-send nanti (Sequences)
```

**Email Templates:**
```
GET  /api/v1/email-templates              # List templates
POST /api/v1/email-templates              # Create template
POST /api/v1/sales-tasks/:id/send-email   # Send email from task
  Body: { templateId, customBody, sendAt? }
```

**Integrasi Teknis:**
- Opsional: pake layanan email sending (SendGrid, Resend, dll) atau SMTP langsung
- Email terkirim dari nama/email sales (bukan dari system)
- Tracking reply: jika contact reply, task bisa auto-update

---

### 3. Sumber Task #3 — Google Sheets Migration

**Konsep:**
Data leads/customer existing di Google Sheets akan diimpor ke CRM.
Prosesnya bisa:
- **One-time import**: Upload CSV/Excel → mapping fields → import
- **Sync berkala**: Hubungkan Google Sheets → sync otomatis

**Struktur Sheet** (contoh kolom):
```
| Name | Phone | Email | Source | Notes | Status | Assigned To | Last Contact |
```

**Alur:**
```
Upload CSV / Connect Google Sheets
  → [NEW] Import Service
    → Parse rows
    → Untuk setiap row:
      a. Cari/create contact (by phone or email)
      b. Jika ada notes/status follow-up:
         → Create task based on data
         → AI bisa kasih rekomendasi follow-up
    → Report: { imported, skipped, errors, tasksCreated }
```

**Import Task dari Sheet:**
```
Row: { name: "Budi", phone: "0812...", notes: "Tanya harga produk A", status: "follow-up" }
  → Create contact: Budi
  → AI analyze notes → task type: 'chat', priority: medium
  → Create task: "Follow up: Tawarkan produk A ke Budi"
  → Assign ke sales yang ditentukan (atau default)
```

**Endpoint:**
```
POST /api/v1/import/csv          # Upload CSV → import contacts + tasks
POST /api/v1/import/sheets       # Connect Google Sheets → import
GET  /api/v1/import/jobs/:id     # Cek status import job
```

---

### 4. Sumber Task #4 — Manual

Sales/Leader bisa buat task manual dari mana saja:
- Halaman **Task List**: klik "Buat Task"
- Halaman **Chat**: dari percakapan → "Buat Task"
- Halaman **Customer**: dari profil → "Buat Task"
- Via **API** (untuk integrasi)

---

### 5. AI Suggested Reply + One-Click Send

Ini adalah **value utama**. Setiap task tipe `chat` atau `email` punya:

```
Task Detail:
  Title: "Follow up: Tawarkan produk A ke Budi"
  Contact: Budi (0812-xxx)
  Source: WhatsApp Chat
  AI Suggested Reply: 
    "Halo Budi, bagaimana dengan produk A yang 
     sebelumnya ditanyakan? Ada yang bisa saya bantu?"
  
  [Balas via WA] [Balas via Email] [Tunda] [Selesai]
```

**Saat sales klik "Balas via WA":**
```
→ Buka compose message (prefilled dengan suggested reply)
→ Sales bisa edit atau langsung kirim
→ Klik Send → message dikirim via Baileys
→ Task marked complete
→ Log ke conversation
```

**Saat sales klik "Balas via Email":**
```
→ Buka compose email (prefilled dengan suggested reply)
→ Sales edit → Send
→ Email terkirim via SMTP/API
→ Log ke conversation
```

**AI Suggested Reply — Cara Kerja:**
```
1. Saat task dibuat, AI juga generate suggested reply
2. Prompt: "Berdasarkan percakapan terakhir dengan [contact],
   buatkan draft balasan yang sesuai untuk [taskType].
   Tone: professional, friendly, bahasa Indonesia"
3. Output: { suggestedReply: string }
4. Disimpan di field ai_analysis.suggestedReply
5. Ditampilkan di frontend saat sales buka task
```

---

### 6. Sequences — Auto Follow-up Berseri

Ini adalah **HubSpot Sequences pattern**. Sebuah Sequence adalah rangkaian langkah follow-up yang terjadwal otomatis:

**Contoh Sequence: "New Lead Follow-up"**

```
Step 1: +1 jam  → Chat WA: "Halo, terima kasih sudah menghubungi..."
Step 2: +1 hari  → Chat WA: "Bagaimana, ada yang bisa dibantu?"
Step 3: +3 hari  → Email: "Follow up penawaran produk..."
Step 4: +7 hari  → Task: "Hubungi via telepon jika belum ada respon"
         (jika contact sudah reply di step mana pun → sequence stop)
```

**Model:**

```prisma
model sales_sequences {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  app_id      String   @db.Uuid
  name        String   @db.VarChar(200)
  description String?
  is_active   Boolean  @default(true)
  created_by  String?  @db.Uuid
  created_at  DateTime @default(now()) @db.Timestamptz(6)
  updated_at  DateTime @default(now()) @db.Timestamptz(6)

  steps sales_sequence_steps[]
  @@index([app_id])
  @@map("sales_sequences")
}

model sales_sequence_steps {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  sequence_id String   @db.Uuid
  step_order  Int
  step_type   String   @db.VarChar(20)  // chat | email | task | wait
  // chat: kirim WA via Baileys
  // email: kirim email via SMTP
  // task: buat task untuk sales
  // wait: delay / tunggu

  delay_value Int      // jumlah
  delay_unit  String   @db.VarChar(10)  // minutes | hours | days
  
  template_id String?  @db.Uuid          // template pesan/email
  task_config Json?    // { title, description, priority } untuk step type 'task'
  created_at  DateTime @default(now()) @db.Timestamptz(6)

  sequence    sales_sequences @relation(fields: [sequence_id], references: [id], onDelete: Cascade)
  @@index([sequence_id])
  @@map("sales_sequence_steps")
}

model sales_sequence_enrollments {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  sequence_id String   @db.Uuid
  contact_id  String   @db.Uuid
  assignee_id String?  @db.Uuid         // sales yang handle
  status      String   @default("active") @db.VarChar(20)
  // active | paused | completed | cancelled
  current_step Int?    @default(0)
  started_at  DateTime @default(now()) @db.Timestamptz(6)
  completed_at DateTime?
  created_at  DateTime @default(now()) @db.Timestamptz(6)
  updated_at  DateTime @default(now()) @db.Timestamptz(6)

  @@index([assignee_id, status])
  @@index([contact_id])
  @@index([sequence_id])
  @@map("sales_sequence_enrollments")
}
```

**Alur Sequence:**
```
1. Sales/Leader buat sequence (via UI atau API)
2. AI rekomendasikan sequence yang cocok untuk task tertentu
3. Sales enroll contact ke sequence (manual atau auto)
4. Worker: SequenceEngine cron job (setiap menit)
   → Cek enrollments active
   → Hitung delay dari step terakhir
   → Jika waktunya: execute step (send WA / send email / create task)
   → Jika contact reply: pause sequence (auto-detect reply)
5. Sales bisa monitoring progress di task list
```

---

### 7. Reminder & Auto-send

Ada 3 level reminder:

| Level | Cara | Contoh |
|---|---|---|
| **Manual reminder** | Sales set reminder sendiri | "Ingatkan saya 3 jam lagi" |
| **AI-suggested reminder** | AI rekomendasi waktu follow-up | "Follow-up dalam 3 hari" |
| **Auto-sequence** | System kirim otomatis sesuai sequence | "Kirim WA otomatis +1 jam" |

**Auto-send flow:**
```
Sales set reminder: "Kirim WA otomatis ke Budi besok jam 10:00"
  → Queue job di BullMQ (delayed job)
    → Saat waktunya:
      a. Execute: send WA via Baileys (dengan template yang sudah diset)
      b. Log ke conversation
      c. Update task status
      d. Notify sales: "Pesan terkirim ke Budi"
```

**Endpoint Reminder:**
```
POST /api/v1/sales-tasks/:id/reminder
  { remindAt: "2026-07-16T10:00:00Z", autoSend: true, template: "..." }
```

---

### 8. Leader Oversight — Team Task Dashboard

Leader perlu visibility penuh ke task list setiap sales:

**Halaman Leader: `/team-tasks`**

```
┌──────────────────────────────────────────────┐
│  TASK TIM — [Filter: Sales / Status / Date]   │
├──────────────────────────────────────────────┤
│                                                │
│  ┌──────────┬──────────┬──────────┬──────────┐ │
│  │ Pending   │ Overdue  │ Completed│ On Track │ │
│  │    47     │    12    │   156    │   78%    │ │
│  └──────────┴──────────┴──────────┴──────────┘ │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │ Per Sales:                                │  │
│  │ ┌──────┬───────┬────────┬────────┬─────┐ │  │
│  │ │ Name │ Pending│Overdue │Done/Today│Rate│ │
│  │ ├──────┼───────┼────────┼────────┼─────┤ │
│  │ │ Budi │   12  │    3   │    5   │ 71% │ │
│  │ │ Ani  │   8   │    1   │    7   │ 88% │ │
│  │ │ Citra│   15  │    5   │    3   │ 60% │ │
│  │ └──────┴───────┴────────┴────────┴─────┘ │
│  └──────────────────────────────────────────┘  │
│                                                │
│  [Export Report] [Assign Task] [Create Task]   │
└──────────────────────────────────────────────┘
```

**Analytics untuk Leader:**
- Task completion rate per sales
- Overdue ratio
- Average response time (dari task created → completed)
- Task distribution by type
- Sales ranking by performance
- Trend (hari ini vs kemarin vs minggu lalu)

**Endpoint Leader:**
```
GET /api/v1/sales-tasks/team-stats?period=7d
  → { summary, perSales[], trends[] }

GET /api/v1/sales-tasks/team-list?assignee_id=&status=
  → Leader bisa filter & sort semua task di tim
```

**Role Access:**

| Role | Task Access |
|---|---|
| **Sales** | Own tasks only |
| **Leader** | All tasks in team (+ stats, assign, create for others) |
| **CEO** | Read-only stats (overview dashboard) |
| **Superadmin** | Full access |

---

### 9. Database — Complete Model

```prisma
// ========================================
// TASK MANAGEMENT
// ========================================

model sales_tasks {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  app_id          String   @db.Uuid
  assignee_id     String?  @db.Uuid
  creator_id      String?  @db.Uuid
  conversation_id String?  @db.Uuid
  contact_id      String?  @db.Uuid
  message_id      String?  @db.Uuid
  sequence_enrollment_id String? @db.Uuid

  title           String   @db.VarChar(255)
  description     String?
  task_type       String   @db.VarChar(20)     // chat | email | follow_up | to_do
  channel         String   @default("whatsapp") @db.VarChar(20)  // whatsapp | email | internal
  priority        String   @default("medium") @db.VarChar(20)
  status          String   @default("pending") @db.VarChar(20)

  ai_analysis     Json?    // { confidence, reasoning, suggestedReply, ... }
  source          String   @default("auto_ai") @db.VarChar(20)
  // auto_ai | manual | import | sequence

  due_at          DateTime?
  completed_at    DateTime?
  snoozed_until   DateTime?
  created_at      DateTime @default(now()) @db.Timestamptz(6)
  updated_at      DateTime @default(now()) @db.Timestamptz(6)

  @@index([app_id, assignee_id, status, due_at])
  @@index([app_id, assignee_id, priority, created_at])
  @@index([conversation_id])
  @@index([contact_id])
  @@index([status, due_at])
  @@map("sales_tasks")
}

model sales_task_templates {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  app_id      String   @db.Uuid
  name        String   @db.VarChar(200)
  task_type   String   @db.VarChar(20)
  channel     String   @default("whatsapp") @db.VarChar(20)
  title       String   @db.VarChar(255)
  description String?
  suggested_reply String?
  is_active   Boolean  @default(true)
  created_at  DateTime @default(now()) @db.Timestamptz(6)
  updated_at  DateTime @default(now()) @db.Timestamptz(6)

  @@index([app_id, task_type, channel])
  @@map("sales_task_templates")
}

model sales_sequences {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  app_id      String   @db.Uuid
  name        String   @db.VarChar(200)
  description String?
  trigger_type String? @db.VarChar(50)  // new_lead | no_reply | manual
  is_active   Boolean  @default(true)
  created_by  String?  @db.Uuid
  created_at  DateTime @default(now()) @db.Timestamptz(6)
  updated_at  DateTime @default(now()) @db.Timestamptz(6)

  steps sales_sequence_steps[]
  enrollments sales_sequence_enrollments[]
  @@index([app_id])
  @@map("sales_sequences")
}

model sales_sequence_steps {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  sequence_id   String   @db.Uuid
  step_order    Int
  step_type     String   @db.VarChar(20)  // chat | email | task | wait
  delay_value   Int
  delay_unit    String   @db.VarChar(10)  // minutes | hours | days
  template_id   String?  @db.Uuid
  task_config   Json?    // { title, description, priority } optional
  email_config  Json?    // { subject, body, templateId } optional
  created_at    DateTime @default(now()) @db.Timestamptz(6)

  sequence sales_sequences @relation(fields: [sequence_id], references: [id], onDelete: Cascade)
  @@index([sequence_id])
  @@map("sales_sequence_steps")
}

model sales_sequence_enrollments {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  sequence_id   String   @db.Uuid
  contact_id    String   @db.Uuid
  conversation_id String? @db.Uuid
  assignee_id   String?  @db.Uuid
  status        String   @default("active") @db.VarChar(20)
  current_step  Int?     @default(0)
  last_executed_at DateTime?
  started_at    DateTime @default(now()) @db.Timestamptz(6)
  completed_at  DateTime?
  created_at    DateTime @default(now()) @db.Timestamptz(6)
  updated_at    DateTime @default(now()) @db.Timestamptz(6)

  sequence sales_sequences @relation(fields: [sequence_id], references: [id], onDelete: Cascade)
  contact  contacts?       @relation(fields: [contact_id], references: [id])
  @@index([assignee_id, status])
  @@index([contact_id])
  @@index([sequence_id, status])
  @@map("sales_sequence_enrollments")
}

model email_templates {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  app_id      String   @db.Uuid
  name        String   @db.VarChar(200)
  subject     String   @db.VarChar(500)
  body        String   // HTML or plain text
  variables   Json?    // [{ name, type, defaultValue }]
  is_active   Boolean  @default(true)
  created_by  String?  @db.Uuid
  created_at  DateTime @default(now()) @db.Timestamptz(6)
  updated_at  DateTime @default(now()) @db.Timestamptz(6)

  @@index([app_id])
  @@map("email_templates")
}

model import_jobs {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  app_id        String   @db.Uuid
  created_by    String?  @db.Uuid
  source        String   @db.VarChar(20)  // csv | sheets
  filename      String?
  status        String   @default("pending") @db.VarChar(20)
  total_rows    Int?     @default(0)
  imported      Int?     @default(0)
  skipped       Int?     @default(0)
  errors        Int?     @default(0)
  error_log     Json?    // [{ row, reason }]
  task_created  Int?     @default(0)
  created_at    DateTime @default(now()) @db.Timestamptz(6)
  completed_at  DateTime?

  @@index([app_id, created_by])
  @@map("import_jobs")
}
```

---

### 10. Backend Module Structure

```
apps/backend/src/modules/sales-tasks/
├── index.ts              # Routes
├── service.ts            # Business logic
├── model.ts              # Zod schemas
├── ai-analyzer.ts        # AI Task Analysis (LangChain + Ollama)
└── sequence-engine.ts    # Sequence execution engine

apps/backend/src/modules/sales-sequences/
├── index.ts              # Routes (sequences CRUD + enrollments)
├── service.ts            # Business logic
└── model.ts              # Zod schemas

apps/backend/src/modules/email/
├── index.ts              # Routes (inbound webhook, send, templates)
├── service.ts            # Email service (SMTP / API)
└── model.ts              # Zod schemas

apps/backend/src/modules/import/
├── index.ts              # Routes (CSV upload, sheets connect, job status)
├── service.ts            # Import logic
└── model.ts              # Zod schemas
```

**All Endpoints:**

```
# ——— TASKS ———
GET    /api/v1/sales-tasks
POST   /api/v1/sales-tasks
PATCH  /api/v1/sales-tasks/:id
DELETE /api/v1/sales-tasks/:id
POST   /api/v1/sales-tasks/:id/complete
POST   /api/v1/sales-tasks/:id/snooze       { snoozed_until }
POST   /api/v1/sales-tasks/:id/assign       { assignee_id }
POST   /api/v1/sales-tasks/:id/reminder     { remindAt, autoSend, template? }
POST   /api/v1/sales-tasks/:id/send-whatsapp { body? }
POST   /api/v1/sales-tasks/:id/send-email   { subject, body, templateId? }
GET    /api/v1/sales-tasks/stats
GET    /api/v1/sales-tasks/team-stats        # [LEADER] team-wide stats
GET    /api/v1/sales-tasks/team-list         # [LEADER] all tasks in team
POST   /api/v1/sales-tasks/analyze           { messageId }
POST   /api/v1/sales-tasks/templates         # CRUD task templates

# ——— SEQUENCES ———
GET    /api/v1/sales-sequences
POST   /api/v1/sales-sequences
PATCH  /api/v1/sales-sequences/:id
DELETE /api/v1/sales-sequences/:id
GET    /api/v1/sales-sequences/:id/steps
POST   /api/v1/sales-sequences/:id/steps
PATCH  /api/v1/sales-sequences/steps/:stepId
DELETE /api/v1/sales-sequences/steps/:stepId
POST   /api/v1/sales-sequences/:id/enroll    { contactId, assigneeId? }
POST   /api/v1/sales-sequences/:id/pause
POST   /api/v1/sales-sequences/:id/resume
POST   /api/v1/sales-sequences/:id/cancel

# ——— EMAIL ———
GET    /api/v1/email/templates
POST   /api/v1/email/templates
PATCH  /api/v1/email/templates/:id
DELETE /api/v1/email/templates/:id
POST   /api/v1/email/inbound-webhook        # Inbound email (via forward/API)
POST   /api/v1/email/send                   # Send email from CRM

# ——— IMPORT ———
POST   /api/v1/import/csv                   # Upload CSV file
POST   /api/v1/import/csv/preview           # Preview: show mapping + sample
POST   /api/v1/import/sheets                # Connect Google Sheets
GET    /api/v1/import/jobs/:id              # Check job status
GET    /api/v1/import/history               # List past imports
```

---

### 11. Workers (BullMQ Queues)

```
task-analysis        # AI analysis of messages → create tasks
sequence-engine      # Sequence step execution (cron every minute)
email-send           # Send email (outbound)
email-inbound        # Process inbound email
import-process       # Process CSV/sheets import
reminder-execute     # Execute scheduled reminders / auto-send
```

**Sequence Engine Worker (konsep):**
```typescript
// Setiap 1 menit: cek enrollments active
new Worker('sequence-engine', async (job) => {
  const enrollments = await prisma.sales_sequence_enrollments.findMany({
    where: {
      status: 'active',
      sequence: { is_active: true },
    },
    include: { sequence: { include: { steps: { orderBy: { step_order: 'asc' } } } } },
  })

  for (const enrollment of enrollments) {
    const now = new Date()
    const nextStep = enrollment.sequence.steps[enrollment.current_step ?? 0]
    if (!nextStep) {
      // Sequence complete
      await prisma.sales_sequence_enrollments.update({
        where: { id: enrollment.id },
        data: { status: 'completed', completed_at: now },
      })
      continue
    }

    const lastExecuted = enrollment.last_executed_at ?? enrollment.started_at
    const delayMs = calculateDelay(nextStep.delay_value, nextStep.delay_unit)
    const shouldExecute = now.getTime() >= lastExecuted.getTime() + delayMs

    if (shouldExecute) {
      await SequenceEngineService.executeStep(enrollment, nextStep)
    }
  }
}, { connection: redis })
```

---

### 12. Frontend — All Pages

```
Route                        | Role     | Description
──────────────────────────────┼──────────┼──────────────────────
/sales-tasks                 | Sales    | Task list (own tasks)
/sales-tasks/:id             | Sales    | Task detail + action
/sales-sequences             | Leader   | Manage sequences
/sales-sequences/:id         | Leader   | Edit sequence steps
/team-tasks                  | Leader   | Team task dashboard
/email/templates             | Leader   | Manage email templates
/import                      | Leader   | Upload CSV / connect Sheets
/import/jobs/:id             | Leader   | Import job detail
```

**Dashboard Widget (Sales):**
```
┌──────────────────────────────┐
│  TUGAS HARI INI              │
│  ┌──────┬──────┬──────┐      │
│  │Pending│Overdue│Done  │      │
│  │   8   │   2   │  5   │      │
│  └──────┴──────┴──────┘      │
│  [Lihat Semua →]              │
└──────────────────────────────┘
```

**Sidebar:**
```typescript
// Untuk Sales:
{ id: 'sales-tasks', label: 'Tugas', path: '/sales-tasks', group: 'operasional', icon: ClipboardCheck }

// Untuk Leader (tambahan):
{ id: 'team-tasks', label: 'Tugas Tim', path: '/team-tasks', group: 'operasional', icon: Users }
{ id: 'sequences', label: 'Alur Follow-up', path: '/sales-sequences', group: 'otomasi', icon: StepForward }
{ id: 'email-templates', label: 'Template Email', path: '/email/templates', group: 'outreach', icon: FileText }
{ id: 'import', label: 'Import Data', path: '/import', group: 'sistem', icon: Upload }
```

---

### 13. Fase Pengembangan

| Fase | Fitur | Tujuan |
|---|---|---|
| **Fase 1 — Foundation** | Model DB, CRUD API tasks, AI Analyzer (WA), halaman task list sales, filter by status/priority/type | Sales bisa lihat task auto-generated dari WA |
| **Fase 2 — Action** | One-click send WA (suggested reply), mark complete, snooze, dashboard widget | Sales bisa langsung aksi dari task |
| **Fase 3 — Import** | CSV upload, Google Sheets connect, import + auto-task creation | Migrasi data dari sheet ke CRM |
| **Fase 4 — Email** | Inbound email parser, email templates, send email from task, email channel | Task dari email + reply via email |
| **Fase 5 — Sequences** | Sequence builder, enrollment, auto-execute, auto-pause on reply | Follow-up otomatis berseri |
| **Fase 6 — Leader** | Team dashboard, per-sales stats, reporting, export | Leader monitoring |
| **Fase 7 — Advanced** | Auto-assign by skill/load, performance analytics, AI sequence recommendation, predictive follow-up | Optimization |

---

### 14. Pertimbangan Teknis

**Duplicate Prevention:**
- Task untuk message_id yang sama → cek dulu sebelum create
- Enrollment sequence untuk contact yang sama → cek active enrollment

**Performance:**
- AI analysis async via BullMQ — non-blocking
- Sequence engine cron — batch process, jangan per-contact query
- Cache template & suggested reply di Redis
- Pagination: default 25, max 100

**AI Model:**
- Ollama (`qwen3.5:4b` atau `sales:latest`) untuk MVP
- Azure OpenAI untuk production (lebih stabil, lebih cepat)
- Prompt caching di Redis untuk analysis yang sama

**Email Infrastructure:**
- SMTP: Kirim dari email sales (nama sales <email@domain.com>)
- Inbound: Forward email ke webhook CRM (atau IMAP polling)
- Rate limiting: jangan spam, honor unsubscribe

**Import Flow:**
- Upload file → simpan sementara di MinIO
- Parse di worker (jangan blocking request)
- Preview dulu sebelum import beneran
- Rollback jika error

---

---

## AI Model Architecture — OpenAI

### Model yang Dipakai

| Tier | Model | Input/1M | Output/1M | Fungsi |
|---|---|---|---|---|
| **Tier 1: Classifier** | `gpt-4.1-nano` | $0.10 | $0.40 | Klasifikasi: apakah ini leads? task type? priority? |
| **Tier 2: Generator** | `gpt-4.1-mini` | $0.40 | $1.60 | Generate: title, description, suggestedReply |

### Kenapa GPT-4.1 Nano untuk klasifikasi?

1. **Termurah** — $0.10/1M input, 22x lebih murah dari GPT-5.4 Mini
2. **Cukup untuk structured output** — klasifikasi sederhana (Zod schema), gak perlu reasoning berat
3. **1M context window** — muat banyak history chat
4. **Prompt caching** — system prompt pendek (+-200 tokens), bisa di-cache diskon 50%

### Kenapa GPT-4.1 Mini untuk generate reply?

1. **Butuh kreativitas** — nulis suggested reply yang natural, gak bunyi robot
2. **Cost masih rendah** — $1.60/1M output, dengan output 300 tokens = ~$0.0005 per reply
3. **Untuk auto-reply WA** — quality matters

### Alur 2-Tier

```
Incoming Message (WA/Email)
  │
  ▼
┌──────────────────────────────────────┐
│ TIER 1: CLASSIFIER (gpt-4.1-nano)   │
│                                      │
│ Input:  message + context (5 chat)   │
│ Output: {                             │
│   isActionable: boolean,             │
│   taskType: "chat"|"follow_up"|...,  │
│   priority: "low"|"medium"|...,      │
│   confidence: 0.0-1.0                │
│ }                                     │
│                                      │
│ Cost: ~$0.00005 per call             │
│ (500 input + 50 output tokens)       │
└──────────┬───────────────────────────┘
           │ isActionable === true
           ▼
┌──────────────────────────────────────┐
│ TIER 2: GENERATOR (gpt-4.1-mini)    │
│                                      │
│ Input:  message + context + tier1    │
│ Output: {                             │
│   title: string,                     │
│   description: string,               │
│   suggestedReply: string,            │
│   dueInMinutes: number               │
│ }                                     │
│                                      │
│ Cost: ~$0.001 per call               │
│ (800 input + 300 output tokens)      │
└──────────┬───────────────────────────┘
           ▼
     Create Task + Save ke DB
     + Socket.IO event ke frontend
```

### Kenapa 2 Tier, Bukan 1 Model?

**Masalah**: 80-90% pesan WhatsApp masuk **bukan leads** — spam, group WA, keluarga, OTP. Kalau 1 model dipakai untuk semua, kita bayar mahal untuk generate reply dari pesan sampah.

**Solusi 2-Tier**:
1. **Tier 1 (Nano $0.00005)**: Saring dulu — ini leads atau bukan? Kalau bukan → stop, gak bayar lebih.
2. **Tier 2 (Mini $0.001)**: Hanya untuk yang benar-benar leads → baru generate reply.

**Efisiensi**: Dari 5000 pesan/bulan, hanya +-500 yang leads. Dengan 2-tier:
- Tanpa 2-tier: 5000 × $0.001 = **$5/bulan**
- Dengan 2-tier: (5000 × $0.00005) + (500 × $0.001) = **$0.75/bulan**
- **Hemat 85%**

### Estimasi Cost Bulanan

| Komponen | Volume | Model | Cost |
|---|---|---|---|
| Klasifikasi semua pesan masuk | 5000 msg | Nano | $0.25 |
| Generate reply (actionable ~500) | 500 | Mini | $0.50 |
| Auto-reply WA | 200 | Mini | $0.40 |
| **Total** | | | **~$1.15/bulan** |

### Prompt Design

**Tier 1 — System Prompt:**
```
Anda adalah AI classifier untuk CRM sales.
Tugas: analisis pesan WhatsApp/email dan tentukan apakah 
memerlukan tindakan sales.

Output JSON:
{
  isActionable: boolean,
  taskType: "chat" | "follow_up" | "to_do",
  priority: "low" | "medium" | "high" | "urgent",
  confidence: 0.0 - 1.0
}

Pedoman:
- "chat" = customer bertanya produk/harga/order, butuh balasan
- "follow_up" = customer masih ragu, butuh follow-up nanti
- "to_do" = task internal (update data, dll)
- isActionable=false = spam, OTP, group chat, keluarga
```

**Tier 2 — System Prompt:**
```
Anda adalah AI asisten sales yang membantu membuat tugas 
dan draft balasan untuk customer.

Berdasarkan percakapan dan hasil klasifikasi, buat:

Output JSON:
{
  title: string (max 100 chars, format: "[Tipe] Deskripsi — Nama"),
  description: string (konteks tambahan),
  suggestedReply: string (draft balasan natural, bahasa Indonesia, 
    max 500 chars, siap kirim),
  dueInMinutes: number (0 = ASAP, maks 43200 = 30 hari)
}

Gaya bahasa: profesional, ramah, natural.
Jangan kaku seperti robot.
```

---

## Fase Pengembangan

| Fase | Fitur | Deliverable |
|---|---|---|
| **Fase 1 — Foundation** | Model `sales_tasks` + CRUD API + AI Analyzer (2-tier) + halaman `/sales-tasks` + sidebar + filter + auto-create dari WA | Sales bisa lihat task auto-generated dari WhatsApp |
| **Fase 2 — Action** | One-click send WA (suggested reply) + mark complete + snooze + dashboard widget "Task Hari Ini" | Sales bisa langsung aksi dari task |
| **Fase 3 — Import Sheets** | CSV upload + Google Sheets connect + preview mapping + import job + auto-create task dari data sheet | Migrasi data existing ke CRM |
| **Fase 4 — Email** | Inbound email parser + email templates + send email from task + email channel | Task dari email + reply via email |
| **Fase 5 — Sequences** | Sequence builder UI + enrollment + auto-execute + auto-pause on reply + worker engine | Follow-up otomatis berseri |
| **Fase 6 — Leader** | `/team-tasks` page + per-sales stats + export report + assign task + team dashboard | Leader monitoring |
| **Fase 7 — Advanced** | Auto-assign by skill/load + performance analytics + AI sequence recommendation + predictive scoring | Optimization |

---

## Fase 1 — Detail Implementasi

### Scope
1. **Database**: Model `sales_tasks` + migrasi
2. **Backend**: Module `sales-tasks/` (CRUD + list + stats + AI trigger)
3. **AI**: 2-tier OpenAI (Nano + Mini) untuk klasifikasi + generate
4. **Worker**: Queue `task-analysis` untuk proses async
5. **Frontend**: Halaman `/sales-tasks` + sidebar + dashboard widget
6. **Integrasi**: Hook ke incoming message flow (WA)

### Backend Module Structure
```
apps/backend/src/modules/sales-tasks/
├── index.ts              # Routes
├── service.ts            # Business logic
├── model.ts              # Zod schemas
└── ai-analyzer.ts        # OpenAI 2-tier analyzer
```

### Endpoints Fase 1
```
GET    /api/v1/sales-tasks          # List tasks (filter: assignee, status, priority, type)
POST   /api/v1/sales-tasks          # Create task (manual)
PATCH  /api/v1/sales-tasks/:id      # Update field
DELETE /api/v1/sales-tasks/:id      # Delete
POST   /api/v1/sales-tasks/:id/complete   # Mark complete
POST   /api/v1/sales-tasks/:id/snooze     # Snooze
GET    /api/v1/sales-tasks/stats          # Stats (pending, overdue, completed today)
```

### Frontend Fase 1
```
Route: /sales-tasks
Sidebar: "Task List" → group: 'operasional', icon: ClipboardCheck

Halaman:
├── Header: "Task List" + filter bar
├── Tabs: Semua | Hari Ini | Overdue | Selesai
├── Task cards: title, contact, type badge, priority badge, due date, actions
└── Empty state: "Belum ada tugas" + ilustrasi

Components:
├── TaskList.tsx       (reuse pattern dari halaman chat/customers)
├── TaskCard.tsx       (reuse CrmCard pattern dari crm/shared)
├── TaskFilters.tsx    (reuse filter pattern)
└── TaskEmptyState.tsx (reuse empty state pattern)
```

### Integrasi dengan Incoming Message

Di worker `incoming-message` atau di `webhook/service.ts`:
```
Setelah message disimpan:
  1. Cek apakah sudah ada task untuk message_id ini? (cek duplicate)
  2. Jika belum → add job ke taskAnalysisQueue
  3. Worker jalankan 2-tier AI
  4. Jika actionable → create task
  5. Emit Socket.IO event "sales-task:created"
```

---

## Kesimpulan

Task List ini adalah **Sales Engagement System** yang mencakup:

1. **Multi-source task creation**: WA, Email, Sheets, Manual
2. **AI-powered analysis**: 2-tier OpenAI (Nano + Mini) — cost ~$1/bulan
3. **One-click action**: Sales langsung reply dari task
4. **Sequences**: Follow-up otomatis berseri (HubSpot-style)
5. **Leader oversight**: Team dashboard + analytics
6. **Data migration**: Import dari spreadsheet

Semua fondasi sudah ada di CRM (Elysia, Prisma, BullMQ, Socket.IO, OpenAI, Baileys). Tinggal nambahin layer task + sequence + email + import di atas infrastruktur yang sudah mature.
