# Spec: Halaman Products & Basis Pengetahuan

Dokumen ini adalah **acuan lengkap** untuk membangun halaman **Products** dan mengisi **Basis Pengetahuan** di CRM PIRANUSA. Ditujukan agar developer berikutnya bisa langsung eksekusi tanpa harus baca ulang PDF sumber.

- **Sumber konten**: `~/Downloads/1st DN Presentation Piranusa (1).pdf` (71 hal, Canva, 11 Maret 2026, karya Designata Studio untuk Piranti Nusantara Teknologi).
- **App ID (dev)**: `1713b2f2-0931-45ef-b386-b65799c588fd` (sebagai referensi; resolve by name `PIRANUSA` saat runtime).
- **Status**: Belum dieksekusi. Ini spec.

> **Isi dokumen:**
> 1. Ringkasan scope & prinsip
> 2. Halaman Products (baru — spec teknis lengkap)
> 3. Halaman Basis Pengetahuan (sudah ada — tinggal diisi)
> 4. Data seed 7 produk (konten lengkap dari PDF)
> 5. Data seed 29 knowledge sources (konten lengkap dari PDF)
> 6. Gap konten & langkah berikutnya

---

## 1. Ringkasan Scope & Prinsip

### Yang sudah ada (jangan dibangun ulang)

| Komponen | Status |
|---|---|
| Tabel `products` + `product_variants` di schema | ✅ Ada, tapi belum dipakai mana pun |
| Halaman `/knowledge` (frontend) | ✅ Ada di `apps/frontend/src/routes/_app/knowledge.tsx` |
| Sidebar entry "Basis Pengetahuan" | ✅ Ada di `crm-navigation.ts:149-155` (grup Otomasi) |
| Backend module `knowledge/` + RAG pipeline | ✅ Ada lengkap (extraction → chunking → embedding → retrieval) |
| Kategori produk diambil dari PDF | ❌ Belum ada |

### Yang harus dibangun

| Komponen | Lokasi |
|---|---|
| Backend module `products/` | `apps/backend/src/modules/products/` (baru) |
| Frontend route `/products` | `apps/frontend/src/routes/_app/products/index.tsx` (baru) |
| Sidebar entry "Products" | edit `apps/frontend/src/lib/crm-navigation.ts` |
| Role access untuk `/products` | edit `apps/frontend/src/lib/role-access.ts` |
| Seed 7 produk ke `products` | script `apps/backend/scripts/seed-products.ts` |
| Seed 29 knowledge sources | script `apps/backend/scripts/seed-product-knowledge.ts` |

### Prinsip

1. **Konten produk = katalog global**, tidak di-scope per tim/sales. Semua role lihat produk yang sama. Alasannya: produk adalah barang yang dijual PIRANUSA, bukan milik satu sales.
2. **Knowledge dipakai AI untuk jawab lead**. Strategi chunking harus menjaga konteks produk (judul source = konteks). Lihat §3.2.
3. **Reuse, jangan bangun ulang**. Pipeline knowledge sudah ada (`KnowledgeIndexService`); pattern products mengikuti pattern `companies/` yang baru dibikun Fase 2.
4. **Read-only dulu untuk Products**. CRUD menyusul kalau Benny membutuhkan. Alasan: katalog produk stabil (7 baris dari PDF), nggak sering berubah.

---

## 2. Halaman Products

### 2.1 Tujuan

Satu tempat untuk lihat **daftar software yang PIRANUSA jual**: nama, vendor, kategori, deskripsi singkat, dan varian (lisensi). Dipakai oleh:
- Sales saat milih produk untuk deal di pipeline
- Leader/administrator saat jawab pertanyaan "kalian jual apa aja?"
- Calon integrasi: dropdown produk di halaman Deals/Pipeline

### 2.2 Sidebar entry

Tambahkan ke `apps/backend/src/lib/crm-navigation.ts`, grup `data`, setelah entry `sakti` (line 95-101):

```ts
{
  id: 'products',
  label: 'Produk',
  path: '/products',
  group: 'data',
  icon: Package, // import dari lucide-react
},
```

Pastikan `Package` ikut di-import dari `lucide-react` di baris import paling atas file.

### 2.3 Role access

`apps/frontend/src/lib/role-access.ts` — tambah `/products` ke allow-list semua role (administrator/leader/sales/ceo/superadmin). Pattern sama kayak `/companies`. Lihat comment di `crm-navigation.ts:103-105` soal `getAllowedPrimaryPathsForRole()`.

### 2.4 Backend module

Struktur baru mengikuti pola `apps/backend/src/modules/company/`:

```
apps/backend/src/modules/products/
├── index.ts       # Elysia route: GET /products, GET /products/:id
└── service.ts     # query prisma.products + product_variants
```

#### Endpoint

**`GET /products`**
- Query: `search`, `page`, `per_page`, `category` (optional)
- Response:
```json
{
  "success": true,
  "payload": [
    {
      "id": "uuid",
      "name": "ZWCAD",
      "vendor": "ZWSOFT",
      "category": "CAD",
      "description": "…",
      "base_price": null,
      "image_url": null,
      "is_active": true,
      "variant_count": 0,
      "metadata": { "source": "pdf-1st-dn" }
    }
  ],
  "meta": { "page": 1, "per_page": 20, "total": 7, "total_pages": 1 }
}
```

**`GET /products/:id`**
- Response: detail + daftar varian (`product_variants`).

#### Service logic

- Filter `app_id` = Piranusa app
- Search di `name` (ILIKE) + `metadata.vendor` + `metadata.category`
- `vendor` dan `category` dibaca dari `metadata` JSON (bukan kolom terpisah, karena tabel `products` tidak punya kolom vendor/category). Pakai `metadata->>'vendor'`.
- **Tidak ada scoping per role** (produk global, semua role lihat semua)

#### Registrasi route

Di `apps/backend/src/modules/index.ts`, tambah `import { products } from './products'` dan daftarkan ke app. Pattern sama dengan `company`.

### 2.5 Frontend route

Struktur baru mengikuti `apps/frontend/src/routes/_app/companies/index.tsx` (Fase 2):

```
apps/frontend/src/routes/_app/products/
├── index.tsx           # list page
└── $productId.tsx      # detail page (opsional fase awal)
```

#### List page — UI

- Header: `CrmSectionHeader` title "Produk", subtitle "Software yang PIRANUSA distribusikan."
- Search bar (debounce 300ms, pola `companies/index.tsx:49-57`)
- Tabel kolom: **Produk** (icon + nama), **Vendor**, **Kategori**, **Varian**, **Status**
- Klik baris → navigate ke `/products/$productId`
- Pagination (PAGE_SIZE = 20)
- Empty state: "Belum ada produk. Hubungi administrator untuk menambah katalog."

#### Detail page — UI (opsional, bisa fase awal sederhana)

- Nama produk besar
- Vendor, kategori sebagai chip
- Overview (paragraf dari `description`)
- Section "Untuk siapa" (dari `metadata.target_audience`)
- Section "Fitur utama" (bullet list dari `metadata.features`)
- Section "Kelebihan" (bullet list dari `metadata.advantages`)
- Daftar varian

### 2.6 Seed data 7 produk

Lihat §4 untuk konten lengkap. Script `apps/backend/scripts/seed-products.ts` menjalankan `prisma.products.create` untuk 7 baris. Field yang diisi:

| Field | Sumber |
|---|---|
| `app_id` | resolve by name `PIRANUSA` |
| `name` | "ZWCAD" / "ZWCAD MFG" / dst |
| `description` | Overview singkat (1 paragraf dari PDF) |
| `base_price` | `null` (PDF tidak ada harga) |
| `is_active` | `true` |
| `metadata` | `{ vendor, category, source: 'pdf-1st-dn', target_audience, features[], advantages[] }` |

Idempoten: `upsert` by `(app_id, name)` kalau ada unique constraint. Kalau belum ada, cek dulu via `findFirst` sebelum insert (pola `backfill-companies.ts:96-112`).

---

## 3. Halaman Basis Pengetahuan

### 3.1 Status: sudah lengkap infrastrukturnya

Yang sudah ada, **jangan dibangun ulang**:
- Sidebar entry "Basis Pengetahuan" → `crm-navigation.ts:149-155`
- Halaman `/knowledge` → `apps/frontend/src/routes/_app/knowledge.tsx`
- Backend module → `apps/backend/src/modules/knowledge/` (extraction, indexing, query)
- Tabel: `knowledge_sources`, `knowledge_source_files`, `knowledge_chunks`, `knowledge_categories`, `knowledge_faqs`, `knowledge_query_logs`
- Pipeline RAG via BullMQ worker (`KnowledgeIndexService.enqueueKnowledgeChangeEvent`)

**Yang kurang: konten.** Saat ini knowledge base kosong (tidak ada sumber produk PIRANUSA yang di-seed). Tujuannya: supaya AI yang jawab lead WA bisa jawab pertanyaan "ZWCAD itu apa?", "Enscape fitur apa?", "Piranusa berdiri sejak kapan?".

### 3.2 Strategi chunking — granular per section

**Masalah dengan chunker default**: `indexing-service.ts:145-161` (`splitIntoChunks`) pakai sliding-window karakter 1000 char overlap 120. Text >1000 char dipecah tanpa hormati batas produk/bagian. Bisa terjadi chunk berisi "Kelebihan akhir ZWCAD + Overview awal ZWCAD MFG" → retrieval kotor.

**Solusi**: bikin **1 source per produk×bagian**. Setiap source:
- `title` = "ZWCAD — Overview" / "ZWCAD — Fitur Produk" / dst (judul self-describing)
- `content` ≤ 1000 char (1 section PDF rata-rata 400-800 char)
- Saat worker chunking, text ≤1000 char = **1 chunk utuh** (`indexing-service.ts:148`)
- Judul source otomatis di-prepend ke content saat chunk dibentuk (`indexing-service.ts:855`: `[source.title, extraction.content].join("\n")`)
- Hasil: tiap chunk = `[ZWCAD — Fitur Produk]\n<isi 6 fitur>` → retrieval presisi

Total: **7 produk × 4 bagian + 1 profil perusahaan = 29 sources**.

4 bagian per produk:
1. **Overview** — paragraf pengenalan
2. **Untuk Siapa** — target pengguna & penggunaan
3. **Fitur Produk** — 6 fitur utama
4. **Kelebihan** — 6 keunggulan

### 3.3 Script seed

File: `apps/backend/scripts/seed-product-knowledge.ts`

Pola mengikuti `backfill-companies.ts`. Struktur:

```
1. Resolve APP_ID (findFirst apps by name "PIRANUSA"; fail kalau 0 atau >1)

2. Upsert kategori "Product Knowledge" di knowledge_categories
   (findFirst by app_id + name; create kalau tidak ada)

3. Loop 29 data (lihat §5 untuk konten lengkap):
   { title, content, metadata: { product, vendor, section, source: 'pdf-1st-dn' } }

   Untuk tiap data:
   a. prisma.knowledge_sources.findFirst by (app_id, title)
      - Kalau ada → skip (atau update content kalau berubah, naikkan active_version)
      - Kalau tidak ada → create:
        {
          app_id, title, content,
          type: 'manual', format: 'text', source_type: 'manual',
          category_id, metadata, status: 'pending', is_active: true
        }
   b. KnowledgeIndexService.enqueueKnowledgeChangeEvent({
        action: 'create',
        entity: 'source',
        app_id,
        knowledge_id: source.id
      })

4. Report: source created / skipped / total
   Instruction: "Jalankan worker (APP_MODE=worker bun run src/index.ts) untuk
                memproses embedding. Cek status di /knowledge sampai 'ready'."
```

### 3.4 Hal yang perlu dijalankan manual setelah seed

1. **Worker harus jalan**: `bun run dev:worker` (BullMQ process `KNOWLEDGE_CHANGE_EVENT_JOB`)
2. **AI provider configured**: `resolveEmbeddingRuntime` (`indexing-service.ts:172-220`) butuh `AZURE_OPENAI_ENDPOINT`/`AZURE_OPENAI_API_KEY` atau `OPENAI_API_KEY`. Kalau belum, source akan stuck di status `extracting`.
3. **Verifikasi**: setelah worker selesai, cek di UI `/knowledge` — 29 source dengan status `ready`. Lalu test retrieval via query lead dummy.

### 3.5 Chatbot ID — default null (app-wide)

`knowledge_sources.chatbot_id` dibiarkan `null` agar **semua AI di app PIRANUSA bisa baca knowledge ini**, tidak terikat chatbot tertentu. Konsekuensi: chatbot apa pun yang query RAG akan temukan source produk.

**Catatan untuk developer**: verifikasi bahwa retrieval path yang dipakai AI WA lead juga query source dengan `chatbot_id IS NULL`. Kalau ternyata WA lead hanya query `chatbot_id = <id-tertentu>`, perlu set `chatbot_id` saat create source. Cek di `apps/backend/src/modules/knowledge/service.ts` (fungsi retrieval) dan konfirmasi pola-nya.

---

## 4. Data Seed: 7 Produk (untuk tabel `products`)

Field `metadata` JSON berisi `vendor`, `category`, `target_audience` (array), `features` (array 6 poin), `advantages` (array 6 poin). `description` = overview singkat.

### 4.1 ZWCAD

- **Vendor**: ZWSOFT
- **Category**: CAD (2D drafting & 3D modeling)
- **Description** (overview singkat):
  > ZWCAD adalah perangkat lunak Computer-Aided Design (CAD) yang dikembangkan oleh ZWSOFT untuk membuat gambar teknik dan desain digital secara presisi, terutama dalam bentuk drafting 2D dan pemodelan 3D. Software ini mendukung format DWG sehingga kompatibel dengan banyak sistem CAD lainnya dan memiliki antarmuka yang mirip dengan software CAD populer seperti AutoCAD, sehingga mudah digunakan oleh profesional desain dan engineering. ZWCAD digunakan oleh lebih dari 1,4 juta pengguna di lebih dari 90 negara.

### 4.2 ZWCAD MFG

- **Vendor**: ZWSOFT
- **Category**: CAD Manufaktur
- **Description**:
  > ZWCAD MFG adalah software CAD (Computer-Aided Design) 2D khusus untuk industri manufaktur yang dikembangkan oleh ZWSOFT dan dibangun di atas platform ZWCAD. Software ini dirancang untuk membantu insinyur dan desainer mekanik membuat gambar teknik yang terstandarisasi, akurat, dan efisien melalui berbagai tools otomatis, library komponen mekanik, serta fitur produktivitas seperti anotasi cerdas dan pembuatan BOM otomatis. ZWCAD MFG dapat diintegrasikan dengan sistem PLM (Product Lifecycle Management).

### 4.3 ZW3D

- **Vendor**: ZWSOFT
- **Category**: 3D CAD/CAM/CAE
- **Description**:
  > ZW3D adalah software 3D CAD/CAM/CAE terintegrasi yang dikembangkan oleh ZWSOFT untuk mendukung seluruh proses pengembangan produk, mulai dari desain 3D, simulasi teknik, hingga proses manufaktur. Platform ini menggabungkan kemampuan pemodelan 3D, analisis struktur, pembuatan gambar teknik, serta perencanaan machining CNC dalam satu sistem terpadu sehingga mempercepat proses desain dan produksi. Dengan pendekatan all-in-one CAx solution, ZW3D membantu perusahaan mengoptimalkan performa produk, mengurangi waktu pengembangan, dan menekan biaya prototyping serta produksi.

### 4.4 Enscape

- **Vendor**: Chaos
- **Category**: Real-time Rendering & VR
- **Description**:
  > Enscape adalah software real-time rendering dan virtual reality (VR) visualization yang dikembangkan oleh Chaos untuk membantu pengguna memvisualisasikan desain arsitektur dan interior secara langsung dari software CAD/BIM yang mereka gunakan. Enscape terintegrasi langsung dengan aplikasi desain seperti Revit, SketchUp, Rhino, Archicad, dan Vectorworks sehingga pengguna dapat melihat perubahan desain secara instan tanpa proses ekspor atau rendering terpisah.

### 4.5 Archicad

- **Vendor**: Graphisoft
- **Category**: BIM
- **Description**:
  > Archicad adalah software Building Information Modeling (BIM) yang dikembangkan oleh Graphisoft untuk membantu arsitek dan profesional AEC (Architecture, Engineering, Construction) merancang, memvisualisasikan, dan mendokumentasikan proyek bangunan secara digital dalam lingkungan 3D yang terintegrasi. Dengan tools BIM yang intuitif, Archicad memungkinkan pengguna membuat model bangunan lengkap yang berisi data desain, struktur, dan sistem bangunan. Software ini mendukung kolaborasi tim melalui teknologi OpenBIM dan BIMcloud.

### 4.6 SketchUp

- **Vendor**: Trimble
- **Category**: 3D Modeling
- **Description**:
  > SketchUp adalah software 3D modeling yang dikembangkan oleh Trimble untuk membuat model tiga dimensi dengan cepat dan intuitif, mulai dari sketsa konsep sederhana hingga model bangunan atau produk yang kompleks. Software ini dikenal karena antarmuka yang mudah digunakan dan workflow yang memungkinkan pengguna membuat, mengedit, dan memvisualisasikan desain secara langsung dalam lingkungan 3D. SketchUp memiliki ekosistem lengkap seperti 3D Warehouse, Extension Warehouse, dan LayOut.

### 4.7 D5 Render

- **Vendor**: D5 (independent)
- **Category**: Real-time GPU Rendering
- **Description**:
  > D5 Render adalah software real-time rendering berbasis GPU yang dirancang untuk menghasilkan visualisasi 3D fotorealistik secara cepat untuk proyek desain arsitektur, interior, landscape, dan produk. Software ini memungkinkan pengguna mengubah model 3D menjadi gambar, animasi, atau pengalaman virtual secara instan dengan teknologi seperti ray tracing dan global illumination. D5 Render mendukung integrasi langsung dengan berbagai software modeling seperti SketchUp, Revit, Rhino, 3ds Max, Archicad, dan Blender.

### 4.8 5 produk di sitemap PDF tapi tanpa detail konten

PDF menyebutkan 5 produk ini di sitemap (halaman 16) tetapi **tidak memiliki slide detail**. Perlu suplai konten terpisah dari PIRANUSA sebelum bisa di-seed:

| Produk | Vendor (perkiraan) | Status konten |
|---|---|---|
| V-Ray | Chaos | ❌ Tidak ada di PDF |
| Corona | Chaos | ❌ Tidak ada di PDF |
| Kaspersky | Kaspersky | ❌ Tidak ada di PDF |
| Adobe | Adobe | ❌ Tidak ada di PDF |
| Microsoft | Microsoft | ❌ Tidak ada di PDF |

---

## 5. Data Seed: 29 Knowledge Sources (konten lengkap dari PDF)

Setiap source di bawah punya:
- `title` (judul self-describing)
- `content` (text ≤ 1000 char)
- `metadata` = `{ product, vendor, section, source: 'pdf-1st-dn' }`

### 5.1 ZWCAD

#### Source 1 — `ZWCAD — Overview`
```
ZWCAD adalah perangkat lunak Computer-Aided Design (CAD) yang dikembangkan oleh ZWSOFT untuk membuat gambar teknik dan desain digital secara presisi, terutama dalam bentuk drafting 2D dan pemodelan 3D. Software ini mendukung format DWG sehingga kompatibel dengan banyak sistem CAD lainnya dan memiliki antarmuka yang mirip dengan software CAD populer seperti AutoCAD, sehingga mudah digunakan oleh profesional desain dan engineering. ZWCAD digunakan oleh lebih dari 1,4 juta pengguna di lebih dari 90 negara, dan dirancang untuk meningkatkan produktivitas dalam proses perancangan, dokumentasi teknis, serta kolaborasi proyek di berbagai industri seperti arsitektur, engineering, dan manufaktur.
```

#### Source 2 — `ZWCAD — Untuk Siapa`
```
Software ini digunakan untuk:
- Membuat gambar teknik dan desain CAD secara presisi.
- Mengembangkan drafting 2D dan pemodelan 3D untuk proyek teknik.
- Mengelola dokumentasi desain seperti denah bangunan, komponen mekanik, dan infrastruktur.
- Meningkatkan efisiensi proses desain melalui automasi dan fitur pintar.
- Mendukung kolaborasi proyek melalui kompatibilitas file DWG dengan software CAD lain.

Software ini ditujukan untuk:
- Arsitek
- Insinyur (engineer)
- Desainer produk dan industri
- Perusahaan konstruksi dan manufaktur
- Mahasiswa dan profesional CAD
```

#### Source 3 — `ZWCAD — Fitur Produk`
```
1. Parametric Design — pengguna menambahkan geometric dan dimensional constraints pada objek desain. Perubahan ukuran/bentuk dapat dilakukan tanpa menggambar ulang seluruh objek. Mempercepat revisi desain dan meningkatkan konsistensi proyek.

2. Smart Dimension — mengenali jenis objek secara otomatis dan langsung menghasilkan dimensi yang sesuai. Pengguna tidak perlu terus berpindah antar perintah dimensi. Mempercepat proses anotasi gambar teknik dan mengurangi kesalahan pengukuran.

3. Smart Match — mendeteksi objek atau bentuk yang identik dalam gambar. Pengguna dapat melakukan perubahan pada beberapa objek sekaligus secara otomatis. Mengurangi pekerjaan repetitif saat mengedit desain.

4. Similar Search — mencari blok atau objek yang mirip di file lokal berdasarkan referensi grafis. Elemen desain lama dapat digunakan kembali dalam proyek baru. Meningkatkan efisiensi dan konsistensi desain.

5. Smart Plot — membantu proses pencetakan dan ekspor gambar CAD secara batch. Sistem otomatis mengenali ukuran kertas dan mengatur pengaturan plot yang sesuai. Mempermudah proses output desain terutama pada proyek dengan banyak lembar gambar.

6. ZWCAD Toolbox — menyediakan berbagai alat seperti layer, dimension, dan selection tools dalam satu panel. Panel dapat dikustomisasi sesuai kebutuhan pengguna. Proses drafting menjadi lebih cepat dan terorganisir.
```

#### Source 4 — `ZWCAD — Kelebihan`
```
1. Kompatibilitas DWG yang Tinggi — mendukung format DWG secara native, file dapat dibuka, diedit, dan disimpan tanpa konversi tambahan. Memudahkan pertukaran data dengan software CAD lain, penting dalam proyek kolaboratif.

2. Antarmuka yang Familiar — dirancang mirip dengan software CAD populer seperti AutoCAD. Struktur menu, command, dan shortcut serupa membuat pengguna baru dapat beradaptasi dengan cepat. Mengurangi waktu pelatihan bagi tim desain.

3. Performa Cepat dan Ringan — performa cepat dan efisien bahkan saat menangani gambar berukuran besar. Dapat berjalan baik pada spesifikasi komputer yang lebih rendah dibanding beberapa CAD lain. Fleksibel untuk berbagai lingkungan kerja.

4. Produktivitas yang Tinggi — dengan fitur otomatisasi seperti Smart tools dan parametric design, pengguna menyelesaikan pekerjaan lebih cepat. Banyak proses manual dapat dipersingkat. Meningkatkan efisiensi workflow.

5. Fleksibilitas dan Customization — mendukung berbagai API seperti LISP, VBA, dan .NET untuk pengembangan add-ons atau automasi. Perusahaan dapat menyesuaikan software dengan workflow mereka. Cocok untuk berbagai industri.

6. Biaya Lebih Kompetitif — menawarkan biaya lisensi yang lebih terjangkau dibanding beberapa software CAD lain. Model lisensi memberikan nilai investasi jangka panjang. Sering dipilih sebagai alternatif CAD profesional yang lebih ekonomis.
```

### 5.2 ZWCAD MFG

#### Source 5 — `ZWCAD MFG — Overview`
```
ZWCAD MFG adalah software CAD (Computer-Aided Design) 2D khusus untuk industri manufaktur yang dikembangkan oleh ZWSOFT dan dibangun di atas platform ZWCAD. Software ini dirancang untuk membantu insinyur dan desainer mekanik membuat gambar teknik yang terstandarisasi, akurat, dan efisien melalui berbagai tools otomatis, library komponen mekanik, serta fitur produktivitas seperti anotasi cerdas dan pembuatan BOM otomatis. Selain itu, ZWCAD MFG dapat diintegrasikan dengan sistem PLM (Product Lifecycle Management) untuk mendukung pengelolaan data desain sepanjang siklus hidup produk dan meningkatkan kolaborasi dalam tim engineering.
```

#### Source 6 — `ZWCAD MFG — Untuk Siapa`
```
Software ini digunakan untuk:
- Membuat gambar teknik dan desain komponen mekanik secara presisi.
- Menghasilkan gambar assembly dan dokumentasi manufaktur yang terstandarisasi.
- Mengelola komponen, simbol mekanik, dan daftar material (BOM) dalam proyek desain.
- Mempercepat proses desain dengan tools otomatis dan library komponen standar.
- Mengintegrasikan data desain dengan sistem manajemen produk (PLM).

Software ini ditujukan untuk:
- Mechanical engineers
- Desainer manufaktur
- Perusahaan industri dan manufaktur
- Tim engineering
- Mahasiswa atau profesional CAD
```

#### Source 7 — `ZWCAD MFG — Fitur Produk`
```
1. Standard Part Library — library komponen mekanik standar berisi ratusan ribu bagian seperti baut, sekrup, dan rivet. Mendukung standar internasional ISO, DIN, ANSI, dan JIS. Pengguna dapat menghasilkan tampilan komponen pada gambar teknik hanya dengan memilih parameter yang diperlukan.

2. Balloons & Automatic BOM — membuat balloon annotation untuk menandai komponen pada gambar assembly dengan satu klik. Sistem otomatis menghasilkan Bill of Materials (BOM) yang terhubung dengan komponen. Mengurangi pekerjaan manual dan meminimalkan kesalahan dokumentasi.

3. Power Dimension — fitur dimensi cerdas yang mengenali objek otomatis dan menghasilkan jenis dimensi yang sesuai (panjang, diameter, sudut). Pengguna tidak perlu berpindah command untuk setiap jenis dimensi. Mempercepat proses anotasi.

4. Symbol Annotation — pembuatan simbol teknis seperti welding symbols, geometric tolerance, dan surface texture umum dalam desain mekanik. Pengguna dapat mengedit simbol dengan cepat melalui double-click dan menyimpan parameter sebagai template. Dokumentasi teknik lebih konsisten.

5. Detail View — membuat tampilan pembesaran pada bagian tertentu dari komponen secara otomatis. Jika desain utama diubah, tampilan detail diperbarui otomatis. Sangat berguna untuk menampilkan area kecil yang membutuhkan penjelasan teknis lebih rinci.

6. Drawing & Construction Tools — lebih dari 40 drawing tools dan 20 construction tools seperti Smart Line, Center Line, Chamfer, dan Fillet. Membantu membuat geometri teknik dengan cepat dan presisi. Proses drafting dan konstruksi desain mekanik jauh lebih efisien.
```

#### Source 8 — `ZWCAD MFG — Kelebihan`
```
1. Dirancang Khusus untuk Industri Manufaktur — dikembangkan khusus untuk kebutuhan desain mekanik dan manufaktur, bukan CAD umum. Memiliki banyak tools relevan dengan proses desain komponen, assembly, dan dokumentasi produksi. Workflow engineering lebih efisien dibanding CAD generik.

2. Library Komponen yang Sangat Lengkap — library komponen mekanik sangat luas mencakup berbagai standar internasional. Pengguna tidak perlu menggambar ulang komponen umum seperti baut atau mur dari awal. Mempercepat pembuatan desain dan menjaga konsistensi standar teknik.

3. Otomatisasi Workflow Desain — fitur BOM otomatis, annotation tools, dan drawing automation mengurangi pekerjaan manual. Desainer menyelesaikan pekerjaan lebih cepat dengan risiko kesalahan lebih kecil. Beberapa studi menunjukkan peningkatan produktivitas signifikan.

4. Mendukung Standar Internasional — mendukung standar desain mekanik ISO, DIN, ANSI, dan ASME. Gambar teknik dapat digunakan dalam proyek global atau industri dengan standar ketat. Memudahkan kolaborasi lintas negara.

5. Integrasi dengan Sistem PLM — dapat terhubung dengan sistem Product Lifecycle Management seperti Teamcenter atau Windchill. Pengelolaan data desain, dokumentasi produk, dan revisi desain lebih terstruktur. Siklus hidup produk dikelola lebih efektif.

6. Meningkatkan Efisiensi Desain Mekanik — tools khusus membantu mempercepat proses desain dan dokumentasi produk mekanik. Fitur part library, annotation tools, dan assembly automation membuat tim engineering bekerja lebih cepat dan akurat. Proses desain hingga produksi lebih efisien.
```

### 5.3 ZW3D

#### Source 9 — `ZW3D — Overview`
```
ZW3D adalah software 3D CAD/CAM/CAE terintegrasi yang dikembangkan oleh ZWSOFT untuk mendukung seluruh proses pengembangan produk, mulai dari desain 3D, simulasi teknik, hingga proses manufaktur. Platform ini menggabungkan kemampuan pemodelan 3D, analisis struktur, pembuatan gambar teknik, serta perencanaan machining CNC dalam satu sistem terpadu sehingga mempercepat proses desain dan produksi. Dengan pendekatan all-in-one CAx solution, ZW3D membantu perusahaan mengoptimalkan performa produk, mengurangi waktu pengembangan, dan menekan biaya prototyping serta produksi.
```

#### Source 10 — `ZW3D — Untuk Siapa`
```
Software ini digunakan untuk:
- Membuat model 3D dan desain produk mekanik secara presisi.
- Melakukan simulasi teknik seperti analisis struktur atau performa produk sebelum diproduksi.
- Menghasilkan gambar teknik dan dokumentasi desain dari model 3D.
- Mengembangkan proses manufaktur seperti machining CNC melalui modul CAM.
- Mengintegrasikan seluruh proses desain hingga produksi dalam satu workflow digital.

Software ini ditujukan untuk:
- Mechanical engineers
- Desainer produk industri
- Perusahaan manufaktur
- Tim R&D (Research and Development)
- Mahasiswa atau profesional CAD/CAM
```

#### Source 11 — `ZW3D — Fitur Produk`
```
1. 3D CAD Modeling — tools lengkap untuk pemodelan 3D seperti solid modeling dan surface modeling. Pengguna dapat membuat komponen individual maupun assembly besar dengan kontrol parametrik fleksibel. Mendukung proses desain mekanik yang detail dan akurat.

2. Integrated CAD-CAE-CAM Platform — mengintegrasikan CAD (design), CAE (simulation), dan CAM (manufacturing) dalam satu platform. Desainer melakukan desain, analisis, dan perencanaan produksi tanpa berpindah software. Mengurangi potensi kesalahan data.

3. Assembly Design — membuat dan mengelola struktur produk kompleks dengan ribuan komponen dalam satu model. Tools untuk constraint, motion simulation, dan visualisasi hubungan antar komponen. Memastikan integrasi komponen bekerja benar sebelum produksi.

4. Engineering Simulation — simulation tools untuk analisis struktur, getaran, panas, dan simulasi fluida. Engineer dapat mengevaluasi performa produk sebelum manufaktur. Mengurangi kebutuhan prototipe fisik dan mempercepat pengembangan.

5. Advanced CAM Machining — modul CAM untuk machining CNC dengan strategi roughing, finishing, dan drilling. Mendukung machining hingga 2-5 axis untuk presisi tinggi. Simulasi toolpath memverifikasi proses produksi sebelum dijalankan.

6. Multi-Format Data Compatibility — mendukung lebih dari 20 format file CAD industri. Pengguna dapat impor/ekspor data dari berbagai software desain. Menjaga atribut desain dan riwayat pemodelan tetap akurat saat dikonversi.
```

#### Source 12 — `ZW3D — Kelebihan`
```
1. Solusi All-in-One untuk Pengembangan Produk — menggabungkan desain, simulasi, dan manufaktur dalam satu platform CAx terpadu. Workflow lebih efisien karena semua proses dalam satu lingkungan kerja. Mempercepat pengembangan produk dari konsep hingga produksi.

2. Efisiensi Waktu dan Produktivitas Tinggi — tools otomatis dan integrasi desain-manufaktur mempercepat berbagai proses. Beberapa studi menunjukkan peningkatan performa operasi hingga ratusan persen pada tugas tertentu. Tim engineering menyelesaikan proyek lebih cepat.

3. Dukungan Format Data yang Luas — mendukung berbagai format file industri untuk integrasi dengan sistem CAD lain. Perusahaan dapat menggunakan data lama tanpa membuat ulang model desain. Meningkatkan fleksibilitas kolaborasi.

4. Performa Stabil untuk Model Kompleks — dirancang menangani assembly besar dengan ribuan komponen secara stabil. Teknologi tampilan ringan dan sistem manajemen data memungkinkan desain tetap lancar meskipun model sangat kompleks.

5. Mengurangi Biaya Software dan Produksi — menawarkan lisensi permanen dengan biaya lebih kompetitif dibanding banyak software CAD/CAM. Fitur simulasi mengurangi kebutuhan prototipe fisik sehingga menekan biaya pengembangan. Investasi teknologi lebih efisien.

6. Mendukung Kolaborasi dan Manajemen Data — fitur manajemen data dan kolaborasi memungkinkan tim engineering bekerja terkoordinasi dalam satu platform. Data desain dikelola, dibagikan, dan diperbarui secara konsisten. Menjaga integritas data selama pengembangan.
```

### 5.4 Enscape

#### Source 13 — `Enscape — Overview`
```
Enscape adalah software real-time rendering dan virtual reality (VR) visualization yang dikembangkan oleh Chaos untuk membantu pengguna memvisualisasikan desain arsitektur dan interior secara langsung dari software CAD/BIM yang mereka gunakan. Enscape terintegrasi langsung dengan aplikasi desain seperti Revit, SketchUp, Rhino, Archicad, dan Vectorworks sehingga pengguna dapat melihat perubahan desain secara instan tanpa proses ekspor atau rendering terpisah. Dengan teknologi real-time rendering, Enscape memungkinkan desainer membuat visualisasi 3D, walkthrough interaktif, dan presentasi proyek dengan cepat untuk mempercepat pengambilan keputusan desain serta komunikasi dengan klien.
```

#### Source 14 — `Enscape — Untuk Siapa`
```
Software ini digunakan untuk:
- Membuat visualisasi 3D realistis dari model desain arsitektur atau interior.
- Melakukan rendering real-time untuk melihat perubahan desain secara langsung.
- Membuat walkthrough dan pengalaman VR untuk mengeksplorasi desain bangunan secara interaktif.
- Menyajikan presentasi visual proyek kepada klien atau stakeholder dengan lebih jelas.
- Mempercepat proses iterasi desain dan pengambilan keputusan dalam proyek arsitektur.

Software ini ditujukan untuk:
- Arsitek
- Interior designer
- Profesional di industri AEC (Architecture, Engineering, Construction)
- Desainer produk atau visualisasi 3D
- Mahasiswa arsitektur atau desain
```

#### Source 15 — `Enscape — Fitur Produk`
```
1. Real-Time Rendering — melihat rendering visual secara langsung saat melakukan desain di software CAD/BIM. Setiap perubahan model (material, pencahayaan, bentuk) langsung terlihat di tampilan render. Mempercepat eksplorasi desain dan mempersingkat waktu rendering tradisional.

2. Live Synchronization dengan CAD/BIM — sinkronisasi dua arah antara model CAD/BIM dan Enscape. Perubahan di software desain otomatis muncul di tampilan visualisasi tanpa ekspor ulang. Workflow lebih efisien dan interaktif.

3. Virtual Reality Walkthrough — eksplorasi desain menggunakan teknologi VR sehingga pengguna/klien dapat "berjalan" di dalam model bangunan secara virtual. Membantu memahami skala ruang, pencahayaan, dan tata letak secara realistis. Sangat berguna dalam presentasi.

4. Built-in Asset & Material Library — library aset 3D seperti furnitur, tanaman, manusia, dan objek lingkungan yang langsung dipakai. Memperkaya visualisasi tanpa membuat model tambahan dari awal. Mempercepat pembuatan scene visual realistis.

5. AI-Enhanced Visualization — fitur AI seperti AI Enhancer dan AI material generation membantu meningkatkan kualitas visual otomatis. AI memperbaiki detail objek seperti vegetasi, manusia, tekstur material, serta menghasilkan variasi visual. Visual presentasi lebih realistis.

6. High-Quality Output (Images, Panoramas, Animation) — menghasilkan render berkualitas tinggi dalam bentuk gambar, panorama 360°, video animasi, dan walkthrough interaktif. Output berguna untuk presentasi atau kebutuhan pemasaran. Visualisasi menyampaikan konsep lebih jelas.
```

#### Source 16 — `Enscape — Kelebihan`
```
1. Workflow Terintegrasi dengan Software Desain — berjalan langsung di dalam software CAD/BIM populer tanpa workflow terpisah. Pengguna mendesain dan memvisualisasikan proyek secara bersamaan dalam satu lingkungan kerja. Proses desain lebih efisien dan praktis.

2. Rendering Sangat Cepat — teknologi real-time rendering menghasilkan visualisasi dalam hitungan detik dibanding rendering tradisional yang memerlukan waktu lama. Pengguna melakukan iterasi desain lebih cepat. Sangat penting dalam proyek dengan deadline ketat.

3. Mudah Dipelajari dan Digunakan — interface intuitif sehingga pengguna baru mulai menggunakan software dengan cepat. Banyak fungsi dijalankan hanya dengan satu klik tanpa pengaturan kompleks. Mengurangi kurva pembelajaran dibanding software rendering teknis.

4. Visualisasi Interaktif untuk Klien — fitur walkthrough dan VR membuat klien melihat dan menjelajahi desain sebelum proyek dibangun. Klien memahami desain lebih jelas dan mengurangi kesalahpahaman. Meningkatkan kualitas komunikasi dalam proyek.

5. Mendukung Proses Desain yang Lebih Cepat — feedback visual secara langsung membuat desainer mengevaluasi pencahayaan, material, dan ruang secara instan. Pengambilan keputusan desain lebih cepat dibanding metode visualisasi tradisional. Iterasi desain lebih fleksibel.

6. Mendukung Presentasi Proyek Profesional — visualisasi berkualitas tinggi siap untuk presentasi atau pitching proyek. Gambar render, video, atau panorama membantu menunjukkan konsep desain lebih menarik. Nilai tambah dalam komunikasi dengan klien/stakeholder.
```

### 5.5 Archicad

#### Source 17 — `Archicad — Overview`
```
Archicad adalah software Building Information Modeling (BIM) yang dikembangkan oleh Graphisoft untuk membantu arsitek dan profesional AEC (Architecture, Engineering, Construction) merancang, memvisualisasikan, dan mendokumentasikan proyek bangunan secara digital dalam lingkungan 3D yang terintegrasi. Dengan tools BIM yang intuitif, Archicad memungkinkan pengguna membuat model bangunan lengkap yang berisi data desain, struktur, dan sistem bangunan sehingga proses desain hingga dokumentasi konstruksi dapat dilakukan secara lebih efisien dan akurat. Software ini mendukung kolaborasi tim melalui teknologi OpenBIM dan BIMcloud, sehingga berbagai disiplin seperti arsitektur, struktur, dan MEP dapat bekerja bersama dalam satu model proyek terpadu.
```

#### Source 18 — `Archicad — Untuk Siapa`
```
Software ini digunakan untuk:
- Membuat model bangunan 3D berbasis BIM yang mengintegrasikan desain dan data proyek.
- Menghasilkan dokumentasi konstruksi seperti denah, potongan, dan detail bangunan secara otomatis.
- Melakukan visualisasi desain arsitektur untuk presentasi proyek.
- Mengelola dan mengoordinasikan data proyek antara arsitek, insinyur, dan kontraktor.
- Mendukung workflow proyek dari konsep desain hingga tahap konstruksi.

Software ini ditujukan untuk:
- Arsitek
- Insinyur struktur dan MEP
- Perusahaan arsitektur dan konstruksi
- BIM manager dan project coordinator
- Mahasiswa arsitektur atau desain bangunan
```

#### Source 19 — `Archicad — Fitur Produk`
```
1. BIM-Based Architectural Modeling — tools BIM untuk membuat model bangunan 3D yang terhubung dengan data proyek (material, ukuran, struktur). Elemen bangunan seperti dinding, lantai, kolom, dan atap bersifat parametrik dan menyesuaikan otomatis saat desain diubah. Desain lebih akurat dan efisien.

2. Parametric Building Elements — elemen bangunan parametrik seperti wall, slab, beam, roof, column, dan curtain wall yang dapat dikustomisasi. Perubahan satu elemen otomatis memperbarui elemen terkait. Menjaga konsistensi desain selama pengembangan proyek.

3. Visualization and Rendering Tools — tools visualisasi desain dalam bentuk 3D, animasi, dan render fotorealistik. Membuat presentasi visual seperti fly-through animation atau model eksploded. Komunikasi desain menjadi lebih jelas.

4. BIMcloud Team Collaboration — dengan BIMcloud, beberapa pengguna bekerja pada model proyek yang sama secara bersamaan. Perubahan satu anggota tim disinkronkan otomatis dalam model utama. Mempermudah kolaborasi tim di lokasi berbeda.

5. OpenBIM Interoperability — mendukung standar OpenBIM seperti IFC dan BCF untuk pertukaran data dengan software BIM lain. Membantu kolaborasi antar disiplin dalam proyek konstruksi yang menggunakan berbagai platform. Penting untuk koordinasi proyek kompleks.

6. Automatic Documentation — menghasilkan dokumen konstruksi (floor plan, section, elevation, schedules) otomatis dari model BIM. Jika model diubah, dokumentasi diperbarui otomatis. Mengurangi pekerjaan manual dan meningkatkan akurasi dokumen.
```

#### Source 20 — `Archicad — Kelebihan`
```
1. Workflow BIM Terintegrasi — workflow BIM menghubungkan desain, dokumentasi, dan koordinasi proyek dalam satu sistem. Perubahan desain langsung diperbarui di seluruh model dan dokumen proyek. Meningkatkan efisiensi dan akurasi proyek bangunan.

2. Kolaborasi Tim yang Efisien — melalui BIMcloud, tim proyek bekerja pada model yang sama secara real-time. Sinkronisasi otomatis mengurangi konflik data dan kesalahan koordinasi. Sangat penting dalam proyek dengan banyak stakeholder.

3. Visualisasi Desain yang Kuat — tools untuk visualisasi konsep hingga render realistis. Membantu arsitek menjelaskan ide desain kepada klien dan stakeholder lebih jelas. Mempercepat pengambilan keputusan desain.

4. Dukungan Standar Industri OpenBIM — mendukung standar OpenBIM seperti IFC untuk interoperabilitas dengan berbagai software BIM lain. Software lebih fleksibel dalam workflow proyek lintas platform. Meningkatkan transparansi data proyek.

5. Otomatisasi Dokumentasi Proyek — dengan BIM, menghasilkan dokumen teknis otomatis dari model. Mengurangi pekerjaan manual dalam membuat gambar teknik. Dokumen tetap konsisten dengan model bangunan yang sedang dikembangkan.

6. Mendukung Proyek dari Konsep hingga Konstruksi — digunakan pada seluruh tahapan proyek (konsep desain, pengembangan desain, dokumentasi konstruksi). Menjaga konsistensi data sepanjang siklus hidup proyek. Pengembangan proyek lebih terstruktur.
```

### 5.6 SketchUp

#### Source 21 — `SketchUp — Overview`
```
SketchUp adalah software 3D modeling yang dikembangkan oleh Trimble untuk membuat model tiga dimensi dengan cepat dan intuitif, mulai dari sketsa konsep sederhana hingga model bangunan atau produk yang kompleks. Software ini dikenal karena antarmuka yang mudah digunakan dan workflow yang memungkinkan pengguna membuat, mengedit, dan memvisualisasikan desain secara langsung dalam lingkungan 3D. SketchUp juga memiliki ekosistem lengkap seperti 3D Warehouse, Extension Warehouse, dan LayOut yang membantu pengguna membuat model, menambahkan objek siap pakai, serta menghasilkan dokumentasi desain dan kolaborasi proyek secara efisien.
```

#### Source 22 — `SketchUp — Untuk Siapa`
```
Software ini digunakan untuk:
- Membuat model 3D dari konsep desain dengan cepat dan intuitif.
- Mengembangkan visualisasi arsitektur, interior, dan desain produk.
- Membuat presentasi desain dan prototipe digital sebelum proses pembangunan atau produksi.
- Menghasilkan dokumentasi desain dan layout proyek melalui integrasi dengan tools seperti LayOut.
- Mendukung workflow desain dari sketsa awal hingga model siap konstruksi.

Software ini ditujukan untuk:
- Arsitek dan desainer interior
- Urban planner dan landscape designer
- Desainer produk dan industri
- Kontraktor dan builder
- Mahasiswa dan profesional desain 3D
```

#### Source 23 — `SketchUp — Fitur Produk`
```
1. Intuitive 3D Modeling Tools — tools pemodelan 3D intuitif seperti Push/Pull, Follow Me, dan Move tools untuk membuat dan memodifikasi objek dengan cepat. Mengubah bentuk 2D menjadi objek 3D secara langsung. Modeling mudah dipelajari bahkan bagi pengguna baru.

2. 3D Warehouse — perpustakaan online berisi jutaan model 3D siap pakai seperti furnitur, kendaraan, bangunan, dan objek lingkungan. Pengguna langsung mengunduh dan menambahkan ke proyek. Mempercepat desain tanpa membuat semua objek dari awal.

3. Extension Warehouse — ratusan plugin dan ekstensi untuk menambah fungsi baru ke SketchUp. Plugin untuk otomatisasi workflow, simulasi, rendering, hingga analisis desain. SketchUp dapat disesuaikan dengan berbagai kebutuhan industri.

4. LayOut for Documentation — tool terintegrasi untuk membuat dokumen 2D seperti denah, gambar teknis, dan presentasi desain dari model 3D. Mengatur skala gambar, menambahkan anotasi, dan membuat layout dokumen proyek. Menghubungkan model 3D dengan dokumentasi konstruksi.

5. Scan Essentials (Point Cloud Modeling) — impor data point cloud dari pemindaian laser atau photogrammetry untuk membuat model 3D presisi berdasarkan kondisi dunia nyata. Membantu pembuatan model bangunan existing atau proyek renovasi. Proses modeling lebih akurat.

6. Photoreal Materials & Environment Lighting — photorealistic materials dan environment lighting membuat model terlihat realistis langsung di software. Sistem HDRI environment sebagai sumber cahaya dan latar belakang scene. Meningkatkan kualitas visualisasi tanpa rendering terpisah.
```

#### Source 24 — `SketchUp — Kelebihan`
```
1. Antarmuka Intuitif dan Mudah Dipelajari — workflow sederhana membuat SketchUp mudah dipelajari pemula maupun profesional. Tools utama seperti Push/Pull memungkinkan pembuatan model 3D dengan cepat. Kurva pembelajaran rendah dibanding software 3D lain.

2. Ekosistem 3D Warehouse yang Luas — jutaan model siap pakai mempercepat proses desain. Pengguna tidak perlu membuat semua objek dari nol. Sangat berguna untuk visualisasi arsitektur dan interior.

3. Kompatibilitas dengan Berbagai Format File — mendukung banyak format file industri untuk impor/ekspor. Memudahkan integrasi dengan software desain lainnya. Kolaborasi antar platform lebih fleksibel.

4. Fleksibilitas dengan Plugin dan Ekstensi — dengan Extension Warehouse, SketchUp dapat diperluas fungsinya melalui ratusan plugin. Integrasi dengan tools rendering, simulasi, atau BIM. Cocok untuk berbagai bidang desain.

5. Mendukung Workflow Kolaboratif — terhubung dengan Trimble Connect untuk berbagi model dan berkolaborasi online. Tim proyek dapat mengakses model dari berbagai perangkat dan lokasi. Mempermudah koordinasi proyek.

6. Mendukung Berbagai Industri Desain — digunakan di bidang arsitektur, interior design, urban planning, dan desain produk. Fleksibilitas membuatnya cocok untuk berbagai jenis proyek. Salah satu software modeling paling banyak digunakan.
```

### 5.7 D5 Render

#### Source 25 — `D5 Render — Overview`
```
D5 Render adalah software real-time rendering berbasis GPU yang dirancang untuk menghasilkan visualisasi 3D fotorealistik secara cepat untuk proyek desain arsitektur, interior, landscape, dan produk. Software ini memungkinkan pengguna mengubah model 3D menjadi gambar, animasi, atau pengalaman virtual secara instan dengan teknologi seperti ray tracing dan global illumination. D5 Render juga mendukung integrasi langsung dengan berbagai software modeling seperti SketchUp, Revit, Rhino, 3ds Max, Archicad, dan Blender, sehingga perubahan desain dapat disinkronkan secara real-time untuk mempercepat workflow visualisasi dan presentasi proyek.
```

#### Source 26 — `D5 Render — Untuk Siapa`
```
Software ini digunakan untuk:
- Membuat visualisasi 3D fotorealistik secara real-time dari model desain.
- Menghasilkan gambar, video animasi, dan panorama 360° untuk presentasi proyek.
- Mengeksplorasi desain arsitektur atau interior dengan simulasi pencahayaan dan lingkungan realistis.
- Membuat virtual walkthrough atau pengalaman VR untuk memahami ruang secara interaktif.
- Mempercepat proses visualisasi dan komunikasi desain kepada klien atau tim proyek.

Software ini ditujukan untuk:
- Arsitek dan desainer interior
- 3D visualization artist (ArchViz)
- Landscape designer dan urban planner
- Desainer produk
- Mahasiswa dan profesional desain 3D
```

#### Source 27 — `D5 Render — Fitur Produk`
```
1. Real-Time Ray Tracing Rendering — teknologi real-time ray tracing dan GPU acceleration menghasilkan visualisasi dengan pencahayaan dan bayangan realistis secara instan. Pengguna melihat hasil render saat melakukan perubahan desain. Iterasi desain jauh lebih cepat.

2. Real-Time Global Illumination (D5 GI) — sistem global illumination khusus yang menghitung pencahayaan tidak langsung di dalam scene secara otomatis. Memperbarui efek pencahayaan langsung ketika kondisi cahaya berubah. Visual lebih realistis tanpa waktu render lama.

3. AI-Powered Visualization Tools — AI tools seperti AI Enhancer, AI material generator, dan AI scene matching membantu meningkatkan kualitas visual otomatis. AI memperbaiki tekstur, menghasilkan material PBR, serta menyesuaikan atmosfer scene. Mempercepat visualisasi berkualitas tinggi.

4. Asset Library dan Vegetation Tools — library aset besar berisi ribuan model (furnitur, kendaraan, manusia, tanaman, elemen lingkungan). Tools Scatter dan Brush untuk menyebarkan objek landscape otomatis. Memudahkan pembuatan lingkungan visual kompleks dengan cepat.

5. Animation, Panorama, dan VR Visualization — membuat animasi, panorama 360°, serta tur virtual untuk menjelajahi desain secara interaktif. Menampilkan scene menggunakan perangkat VR untuk pengalaman lebih imersif. Sangat berguna untuk presentasi proyek.

6. LiveSync Integration dengan Software Modeling — LiveSync dengan SketchUp, Revit, Rhino, Archicad, Blender, dan 3ds Max. Perubahan model atau material di software modeling langsung diperbarui di D5 Render secara real-time. Workflow desain dan rendering lebih efisien.
```

#### Source 28 — `D5 Render — Kelebihan`
```
1. Rendering Sangat Cepat dengan Teknologi Real-Time — menghasilkan visualisasi berkualitas tinggi dalam waktu sangat singkat. GPU ray tracing membuat proses rendering hampir instan dibanding metode tradisional. Sangat membantu proyek dengan banyak revisi desain.

2. Workflow Visualisasi yang Efisien — dengan LiveSync dan real-time rendering, desainer langsung melihat perubahan model tanpa render ulang manual. Mempercepat proses desain dan evaluasi visual. Meningkatkan produktivitas.

3. Visualisasi Fotorealistik Berkualitas Tinggi — menghasilkan visual sangat realistis melalui simulasi pencahayaan fisik, material PBR, dan efek atmosfer. Kombinasi ray tracing dan global illumination menciptakan hasil render mendekati dunia nyata. Cocok untuk visualisasi profesional.

4. Library Asset yang Lengkap — ribuan aset 3D dan material langsung dipakai dalam scene. Mencakup furnitur, tanaman, kendaraan, manusia, dan objek lingkungan. Membuat scene visual lebih cepat tanpa modeling tambahan.

5. Dukungan AI untuk Otomatisasi Desain — fitur AI mempercepat visualisasi seperti generasi material, peningkatan tekstur, dan pencocokan atmosfer scene. Menghasilkan visual profesional dengan lebih sedikit proses manual. Sangat berguna bagi desainer yang ingin meningkatkan efisiensi.

6. Mendukung Presentasi Proyek yang Imersif — mendukung animasi, panorama 360°, dan pengalaman VR sehingga desain dipresentasikan lebih interaktif. Klien dapat menjelajahi ruang atau bangunan secara virtual sebelum proyek dibangun. Meningkatkan pemahaman desain dan kualitas komunikasi.
```

### 5.8 Profil Perusahaan

#### Source 29 — `Piranusa — Profil Perusahaan`
```
Piranti Nusantara Teknologi (PIRANUSA) adalah distributor software terunggul di Indonesia, telah berpengalaman lebih dari 35 tahun di industri IT. PIRANUSA merupakan distributor resmi ZWSOFT (ZWCAD, ZWCAD MFG, ZW3D) dan bekerjasama dengan developer lain seperti Trimble (SketchUp), Chaos (Enscape), Graphisoft (Archicad), serta D5 Render.

KEUNGGULAN PIRANUSA:
- Berpengalaman 35+ tahun di industri IT
- Tim technical support yang ahli dan terampil
- Achievements dan awards yang meyakinkan
- Portfolio produk beragam dan berkualitas
- Spesialis pada produk software 3D dan pelengkapnya

TARGET MARKET:
- Primer: B2B corporation di industri Arsitektur, Engineering, Manufacturing, dan Construction
- Sekunder: personal/individu, nationwide

KOMITMEN LAYANAN:
- Tim marketing responsif untuk diskusi penentuan software, harga, dll.
- Jaminan technical support setelah pembelian
- Informasi dan rekomendasi software terbaik sesuai kebutuhan
```

---

## 6. Gap Konten & Langkah Berikutnya

### 6.1 Yang TIDAK BISA dijawab AI dari PDF ini

Setelah 29 source ini di-seed, AI bisa jawab pertanyaan tentang:
- Apa itu ZWCAD/ZW3D/dst
- Fitur produk
- Kelebihan produk
- Untuk siapa produk cocok
- Profil & pengalaman PIRANUSA

Tapi AI **TIDAK BISA** jawab pertanyaan berikut karena tidak ada di PDF:

| Topik | Contoh pertanyaan lead | Aksi yang perlu |
|---|---|---|
| **Harga** | "Berapa harga ZWCAD?" | Suplai price list |
| **Spesifikasi minimum** | "ZWCAD jalan di RAM 8GB?" | Suplai system requirements per produk |
| **Versi & update** | "ZWCAD versi terbaru apa?" | Suplai info versi |
| **Detail lisensi** | "Lisensi perpetual atau subscription?" | Suplai model lisensi |
| **Perbandingan** | "ZWCAD vs AutoCAD beda apa?" | Buat tabel komparasi |
| **Demo & trial** | "Bisa trial dulu?" | Suplai policy trial |
| **Training** | "Ada training ZWCAD?" | Suplai info training |
| **5 produk lain** | "Ada V-Ray?" | Suplai konten V-Ray, Corona, Kaspersky, Adobe, Microsoft |

### 6.2 Prioritas pengisian gap (usulan)

1. **Harga + lisensi** — paling sering ditanya lead. Wajib sebelum AI benar-benar berguna.
2. **Spesifikasi minimum** — pertanyaan teknis umum.
3. **5 produk lain** (V-Ray/Corona/Kaspersky/Adobe/Microsoft) — lengkapi katalog.
4. **Perbandingan produk** — bantu lead milih.
5. **Demo/training policy** — info pre-sales.

### 6.3 Cara menambah knowledge setelahnya

Begitu konten tambahan tersedia (mis. Excel harga, dokumen spec), bisa:
1. **Bulk upload** via halaman `/knowledge` (UI sudah ada, terima PDF/DOCX/MD) — cepat tapi chunking default kurang presisi
2. **Tambah entry ke script seed** — presisi, mengikuti pola granular per section
3. **FAQ entries** (`knowledge_faqs` table) — untuk Q&A spesifik seperti "Berapa harga ZWCAD?" → jawaban langsung

---

## 7. Checklist Eksekusi

Urutan rekomendasi (kalau demo besok jadi target, Blok A + C sudah cukup dramatis):

- [ ] **Blok A** — Build halaman Products
  - [ ] Backend module `products/` (index.ts + service.ts)
  - [ ] Daftarkan route di `modules/index.ts`
  - [ ] Frontend route `/products/index.tsx`
  - [ ] Sidebar entry di `crm-navigation.ts`
  - [ ] Role access di `role-access.ts`
- [ ] **Blok C** — Seed 7 produk
  - [ ] Script `seed-products.ts` dengan data dari §4
  - [ ] Verifikasi halaman `/products` menampilkan 7 produk
- [ ] **Blok B** — Seed 29 knowledge sources
  - [ ] Script `seed-product-knowledge.ts` dengan data dari §5
  - [ ] Pastikan `dev:worker` berjalan
  - [ ] Verifikasi semua source ber-status `ready` di `/knowledge`
  - [ ] Test retrieval: "ZWCAD fitur apa?", "Enscape untuk siapa?", "Piranusa berdiri berapa lama?"

---

## 8. Catatan untuk Developer

- **Jangan sentuh `indexing-service.ts`** — pipeline RAG sudah lengkap dan sedang dipakai. Reuse via `KnowledgeIndexService.enqueueKnowledgeChangeEvent()`.
- **Pattern backend**: lihat `apps/backend/src/modules/company/` (Fase 2) sebagai template — Elysia route + service class + prisma query.
- **Pattern frontend**: lihat `apps/frontend/src/routes/_app/companies/index.tsx` sebagai template list page read-only.
- **Pattern script**: lihat `apps/backend/scripts/backfill-companies.ts` untuk pola script idempoten dengan dry-run.
- **Verifikasi chunking**: setelah seed, cek tabel `knowledge_chunks` — harusnya ~29 baris (1 chunk per source karena content ≤1000 char). Kalau ada source dengan >1 chunk, berarti content terlalu panjang — pecah jadi 2 source.
- **App ID resolve**: di script, selalu resolve by name `"PIRANUSA"` via `prisma.apps.findFirst({ where: { name: { contains: 'piranusa', mode: 'insensitive' } } })`. Fail dengan error jelas kalau 0 atau >1 hasil.

---

*Dokumen ini disusun dari `1st DN Presentation Piranusa (1).pdf` (71 halaman, 4 April 2026, Canva). Konten produk adalah kutipan langsung dari PDF; struktur dan strategi chunking adalah rekomendasi teknis untuk implementasi RAG.*
