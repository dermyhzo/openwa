# AgentWA — Spec Fase 1 (MVP)

**Tanggal:** 2026-06-23
**Status:** Draft — menunggu review user
**Ruang lingkup dokumen ini:** HANYA Fase 1 (auto-reply CS bertenaga LLM, multi-produk via multi-session). Fase 2–4 dirancang antarmukanya, tapi tidak diimplementasi di sini.

---

## 1. Ringkasan & Keputusan yang Sudah Dikunci

AgentWA adalah **AI Customer Service untuk WhatsApp** pasar Indonesia, dikirim sebagai **plugin built-in first-party** yang dibundel ke dalam distribusi **AgentWA (= OpenWA yang di-rebrand)**, lalu **di-selfhost masing-masing merchant**.

| Keputusan | Pilihan | Catatan |
|---|---|---|
| Bentuk produk | Plugin built-in (in-process) | Wajib built-in: plugin sandboxed tidak punya akses HTTP → tidak bisa panggil LLM |
| Distribusi | Self-host per merchant | "Multi-merchant" = banyak instalasi, **tiap instalasi single-tenant** |
| Multi-produk | **1 session/nomor WA per brand** | OpenWA multi-session → otak resolve `sessionId → profil brand` |
| **Granularitas plugin** | **1 plugin "otak" + brand=config per-session + shipping=connector** | BUKAN 3 plugin terpisah. Terverifikasi: storage ter-namespace per plugin, antar-plugin cuma lewat hook ber-priority → koordinasi sinkron antar-plugin = lawan framework |
| Arsitektur internal | Hexagonal (core agnostik + adapter + connector) | Meniru plugin `translation` yang sudah ada |
| Provider LLM pertama | APImart (BYOT) | Di balik `LlmPort` → OpenRouter/Gemini menyusul tanpa ubah core |
| Postur | Full-auto | Wajib disertai confidence-gate + handoff + anti-ban guardrails |
| Lokasi kode | `src/plugins/extensions/agentwa/` | Didaftarkan di `ExtensionsRegistrar` |

**Rekomendasi deployment (bukan bagian plugin):** untuk skala banyak sesi, jalankan engine `baileys` (tanpa Chromium, jauh lebih ringan) daripada `whatsapp-web.js`. MVP tetap jalan di engine yang sekarang.

---

## 2. Kontrak Plugin (terverifikasi dari kode, bukan docs)

Sumber: `src/core/plugins/plugin.interfaces.ts`, `src/core/hooks/hook.interfaces.ts`, `src/core/plugins/plugin-loader.service.ts`, `src/plugins/extensions/translation/`.

- **Lifecycle:** implement `IPlugin` — `onEnable(ctx)`, `onConfigChange(ctx)`, `onDisable(ctx)`.
- **Hook:** `ctx.registerHook('message:received', handler, priority?)`; handler terima `HookContext<IncomingMessage>` → `ctx.data`, `ctx.sessionId`, `ctx.source` (`'Engine'`); balikin `{ continue }` (`false` = telan pesan).
- **Balas:** `ctx.messages.sendText(sessionId, chatId, text)` / `ctx.messages.reply(sessionId, chatId, quotedId, text)` — **teks saja** (perm `messages:send`).
- **Baca engine:** `ctx.engine.*` read-only (perm `engine:read`).
- **Storage:** `ctx.storage` = `get/set/delete/list(prefix)`, **di-namespace per plugin** (`data/plugins/<id>/`), **tanpa TTL/counter** (kelola manual).
- **Outbound HTTP:** TIDAK ada capability. Built-in pakai `fetch`/client sendiri (lihat `LibreTranslateClient`). → LLM & API ongkir lewat sini.
- **Config + UI:** dari `manifest.configSchema`, dashboard auto-render form; field `secret: true` untuk API key.

**Konsekuensi granularitas:** karena storage ter-namespace & tak ada panggilan antar-plugin sinkron, semua logika percakapan yang saling bergantung **harus dalam satu plugin**. Yang independen dipisah BUKAN sebagai plugin, tapi sebagai **config per-session (brand)** dan **connector (tool)** di dalam plugin yang sama.

**Payload `IncomingMessage`:** `id, from, to, chatId, body, type, timestamp, fromMe, isGroup, isStatusBroadcast?, author?, mentionedIds?, senderPhone?, contact?{name,pushName}, media?{mimetype,data(base64)…}, quotedMessage?, location?`.

---

## 3. Komponen (tiap unit satu tujuan jelas)

```
src/plugins/extensions/agentwa/
  index.ts                       # AgentWaPlugin: lifecycle + wiring (SATU plugin "otak")
  core/
    agent.coordinator.ts         # orkestrasi pipeline — agnostik, mudah ditest
    pipeline.ts                  # urutan langkah (brand→guard→memory→cache→knowledge→llm→confidence→reply)
    ports.ts                     # LlmPort, KnowledgePort, MemoryPort, GuardrailPort, CachePort,
                                 #   ChatGateway, BrandProfilePort, ToolPort, Clock
  brand/
    brand-profile.resolver.ts    # resolve sessionId → BrandProfile (config default + override storage)
                                 #   → INILAH "multi produk": 1 nomor/session per brand
  llm/
    apimart.client.ts            # implement LlmPort via HTTP APImart (BYOT)
    provider.factory.ts          # pilih provider dari config (apimart MVP; openrouter/gemini stub)
  knowledge/
    profile-knowledge.ts         # KnowledgePort dari BrandProfile (FAQ + profil, per-brand)
  connectors/                    # lapisan TOOL yang dipanggil LLM (function-calling)
    tool.port.ts                 # interface ToolPort { name, description, schema, run(args) }
    tool.registry.ts             # daftar tool aktif per brand (MVP: kosong)
    # (Fase 3) shipping.connector.ts, scalev.connector.ts → implement ToolPort
  guardrails/
    anti-ban.ts                  # rate per-chat, cap harian, jam kerja, delay manusiawi
    confidence.ts                # canAnswer? → kirim : fallback+handoff
  memory/
    conversation-memory.ts       # MemoryPort atas ctx.storage (riwayat N-turn, trim manual)
  adapters/
    plugin-chat.gateway.ts       # ChatGateway atas ctx.messages
    kv.store.ts                  # helper KV + TTL/counter manual atas ctx.storage
```

Registrasi: tambah `AgentWaPlugin` + manifest di `src/plugins/extensions/extensions.module.ts` (pola sama `translation`), **disabled by default**, diaktifkan via `POST /plugins/agentwa/enable`.

---

## 4. Alur Data (per pesan masuk)

```
message:received (HookContext<IncomingMessage>)
  └─ AgentWaPlugin.onMessage → coordinator.handle()
       0. BRAND.resolve(sessionId) → profil brand (persona, knowledge, jam kerja, tool aktif, fallback)
       1. GUARD (anti-ban + relevansi)
          - skip jika: source≠Engine, fromMe, isGroup, isStatusBroadcast, sesi takeover-paused
          - skip jika: cap harian habis / masih cooldown per-chat / di luar jam kerja brand
          → kalau skip: return { continue: true }
       2. MEMORY.load(chatId) → riwayat N-turn terakhir
       3. CACHE.lookup(normalizedQuery)        // MVP: exact-match stub; Fase 2: semantik
          → HIT: pakai jawaban tersimpan (lewati LLM)
       4. KNOWLEDGE.retrieve(query) dari profil brand → potongan FAQ/profil relevan
       5. LLM.complete(...) → output TERSTRUKTUR { reply, canAnswer, confidence?, toolCalls? }
          - tool tersedia dari ToolRegistry profil (MVP: kosong; Fase 3: shipping/scalev)
          - jika ada toolCall → jalankan connector → umpan hasil balik → LLM lanjut
          - sistem prompt: jawab HANYA dari knowledge; set canAnswer=false bila info tak ada
       6. CONFIDENCE.evaluate → gate utama = flag canAnswer (opsional: confidence < confidenceThreshold)
          - lolos → ChatGateway.reply() (dengan typing-delay) + MEMORY.append + CACHE.store + log
          - canAnswer=false / ragu → ChatGateway.reply(fallbackMessage) + flag handoff (+notify owner)
       7. Bookkeeping anti-ban (increment cap harian, set cooldown chat)
  (semua error LLM/tool/storage → fallback + log; hook TIDAK PERNAH crash → return continue:true)
```

**Deteksi human-takeover:** hook `message:sent` — jika ada kiriman `fromMe` yang **bukan** ID kiriman bot (bandingkan dengan ID yang baru bot kirim → berarti CS manusia ikut balas), set `paused:chatId` selama X menit supaya bot berhenti di percakapan itu.

---

## 5. Konfigurasi

**Global (manifest `configSchema`, satu form di dashboard):**
`enabled` (bool) · `provider` (enum: apimart|openrouter|gemini) · `apiKey` (string, **secret**) · `model` (string) · `language` (default `id`) · `maxHistoryTurns` (default 8) · `dailyCap` (number) · `perChatCooldownSec` (number) · `typingDelayMs` (number) · `confidenceThreshold` (number, opsional — gate utama = flag `canAnswer`) · `defaultBrandProfile` (object).

**Per-brand (per session) — `brandProfiles`: map `sessionId → BrandProfile`:**
`{ name, systemPersona, businessProfile, faq, businessHours, fallbackMessage, handoffNotifyNumber, enabledTools[] }`.

`BrandProfileResolver` = `brandProfiles[sessionId] ?? defaultBrandProfile`, boleh dioverride dari storage `brand:<sessionId>` (untuk editor per-brand nanti). **UI editor per-brand yang kaya = tugas host (Fase 1.5);** MVP cukup lewat `brandProfiles` di form config. `onConfigChange` membangun ulang coordinator agar edit langsung berlaku.

---

## 6. Error Handling & Keamanan

- LLM/tool timeout/gagal → kirim `fallbackMessage` + log; jangan crash hook.
- Cap/cooldown habis → diam (biar manusia tangani), jangan spam.
- Cegah loop balasan: selalu skip `fromMe` & kiriman bot sendiri.
- **BYOT key** di config plugin → **rekomendasi: enkripsi-at-rest di config store host** (item hardening; MVP didokumentasikan sebagai risiko).
- Anti-ban guardrails = mitigasi utama risiko banned; sertakan panduan operasional (nomor sekunder, warm-up).

---

## 7. Testing

Pola sama `translation/core` (unit test murni dengan fake ports — tanpa WA/LLM asli):
- Brand resolve: sessionId → profil benar; fallback ke default.
- Guard: pesan grup / `fromMe` / status-broadcast → tidak dibalas.
- Happy path: pesan dalam-scope → reply jawaban LLM (LLM port di-fake).
- Confidence rendah (`canAnswer=false`) → fallback + flag handoff (bukan ngarang).
- Cap harian habis / cooldown aktif → tidak ada reply.
- Human-takeover → bot pause untuk chat itu.
- ToolRegistry kosong (MVP) → alur tetap jalan tanpa tool.

---

## 8. Kriteria Sukses (MVP dianggap selesai bila)

1. Plugin bisa di-enable & dikonfigurasi (APImart key + ≥1 `brandProfiles` per session) dari dashboard.
2. Pesan dari nomor lain ke session brand X → bot balas jawaban LLM **berbahasa Indonesia, ber-grounded ke FAQ brand X**, dalam batas guardrail.
3. Dua session/brand berbeda → masing-masing pakai persona & knowledge-nya sendiri (multi-produk terbukti).
4. Pertanyaan di luar scope → **fallback + flag handoff**, tidak berhalusinasi harga/janji.
5. Pesan grup / pesan sendiri diabaikan; cap, cooldown, jam kerja ditegakkan; human-takeover mem-pause bot.
6. Unit test coordinator hijau.

---

## 9. Di Luar Fase 1 (sengaja ditunda, antarmuka disiapkan)

- **Fase 2 — Bank Q&A semantik** (`CachePort` sudah ada; MVP cuma exact-match stub).
- **Fase 3 — Closing/tool-use:** `connectors/shipping.connector.ts` (Everpro/Mengantar/Lincah) + `scalev.connector.ts` (buat order) implement `ToolPort`, didaftarkan per brand; grounding knowledge dari katalog Scalev.
- **Fase 4 — Loop belajar:** tambang log percakapan (dicatat sejak MVP) → perbaiki bank Q&A & prompt.
- **Promosi connector → plugin terpisah:** kalau butuh lisensi/versioning terpisah (open-core), connector yang stabil dipromosikan jadi plugin yang di-load terpisah, di balik `ToolPort` yang sama.
- **Rebrand host → AgentWA** (logo/nama/dashboard) — tugas host paralel, tidak memblok otak.
- **Modul lisensi** (monetisasi self-host) — license-key activation / open-core.
- **Pemahaman media** (baca foto produk / bukti transfer) — payload sudah mendukung.
