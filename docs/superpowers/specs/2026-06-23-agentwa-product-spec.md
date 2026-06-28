# AgentWA — Product Spec (full vision)

**Tanggal:** 2026-06-23
**Status:** Draft — menunggu review user
**Supersedes:** `2026-06-23-agentwa-mvp-design.md` (plugin-only MVP) dan `2026-06-23-agentwa-mvp-slice1.md`. Logika runtime dari sana (coordinator, guardrails, LLM client, confidence) **dipakai ulang** sebagai "otak"; UX/produk dibangun ulang.

---

## 1. Visi

**AgentWA = AI Customer Service yang belajar gaya CS-mu dari chat asli + dokumen brand, lalu jalan dari semi-otomatis (dipantau) sampai AI-nya sendiri menyarankan "siap full-otomatis".**

Bukan bot FAQ — ini **mengkloning CS manusia**: nada, karakter, gaya tulis, dan pengetahuan diambil dari percakapan nyata. Self-hosted (data pelanggan tidak ke mana-mana → jadi nilai jual + aman privasi).

## 2. Fondasi & yang dipakai ulang

- **Fondasi:** fork OpenWA, di-rebrand jadi **AgentWA**. Layer WhatsApp (multi-session, QR, kirim/terima, hooks) dipakai apa adanya.
- **Otak runtime (reuse):** `agent.coordinator`, `guardrails/anti-ban`, `confidence`, `llm` provider adapter, `ports` — sudah dibuat & lulus test. Tetap dipakai; sumber knowledge-nya yang berubah (dari "FAQ manual" → "hasil belajar").
- **Dibuang:** form config plugin yang sempit. Diganti onboarding wizard + halaman AI Agent.

## 3. Keputusan terkunci

| Hal | Pilihan |
|---|---|
| Fondasi | Fork OpenWA (rebrand → AgentWA) |
| Sumber chat training | **Dua-duanya**: tarik langsung via OpenWA + import file export (WAnalysis) |
| LLM provider | **APImart & OpenRouter** (dua-duanya), BYOT |
| Target | Produk penuh (10 langkah), dibangun bertahap |
| Postur | Semi-otomatis (pantau) dulu → AI sarankan full-auto saat matang |

## 4. Arsitektur

```
┌─ Dashboard (React, di fork) ─────────────────────────────┐
│  Onboarding Wizard · Halaman AI Agent · Inbox Review ·     │
│  Voice Card editor · Q&A manager · Docs/Image upload ·     │
│  Readiness dashboard                                       │
└───────────────┬───────────────────────────────────────────┘
                │ REST
┌─ Backend (NestJS, modul baru di fork) ────────────────────┐
│  agent-config · ingestion (chat) · learning (voice+Q&A) · │
│  knowledge (RAG docs + katalog gambar) · review/inbox ·    │
│  readiness · runtime AGENT (reuse coordinator+guardrails)  │
└──────┬──────────────────────────┬─────────────────────────┘
       │ hooks message:received    │ engine (getChats/fetchMessages)
┌─ OpenWA core (WhatsApp) ─────────────────────────────────┐
│  sessions · engine (wweb.js/baileys) · storage · webhooks │
└───────────────────────────────────────────────────────────┘
```

**Data model (DB, per tenant/session):**
- `agent_config` — provider, apiKey(enc), model, mode (off/supervised/auto), guardrail params.
- `voice_profile` — Voice Card: nada, formalitas, emoji, sapaan/penutup, panjang balasan, contoh frasa khas. (Editable.)
- `qna_entry` — pertanyaan, jawaban, sumber (mined/manual), enabled, embedding.
- `doc_chunk` — potongan dokumen brand + embedding (RAG).
- `product_asset` — gambar/produk: file, caption (auto via vision), harga, atribut.
- `draft` — balasan AI menunggu approve (mode supervised) + edit manusia (sinyal latih).
- `readiness_metric` — coverage Q&A, approval-rate, confidence rata-rata, dst.

## 5. Onboarding Wizard (10 langkah)

1. **Token OpenWA** — masukin admin/API key OpenWA (atau auto kalau fresh install).
2. **Onboarding** — sambutan + penjelasan singkat alur.
3. **Scan QR** — connect WhatsApp (pakai flow OpenWA yang ada).
4. **Token LLM** — pilih APImart / OpenRouter, paste key, tombol **Tes koneksi**.
5. **Sumber chat** — (a) **tarik langsung** dari WA via OpenWA (pilih kontak/periode), dan/atau (b) **upload file export** (WAnalysis). → dinormalisasi jadi transcript seragam.
6. **AI belajar gaya** — dari transcript → **Voice Card** (nada/karakter/gaya) + **Q&A hasil tambang otomatis**. Ditampilkan untuk **kamu approve/edit** (transparan, kamu pegang kendali).
7. **Upload brand docs** — PDF/teks → RAG. Disediakan **template brand-doc** (FAQ, kebijakan, daftar produk, panduan tone) untuk diisi.
8. **Upload gambar/produk** — foto produk/footage → **katalog produk** (caption otomatis via vision) yang bisa dikirim bot saat closing.
9. **AI pelajari semua** — index Q&A + docs + katalog; tampilkan ringkasan apa yang dipelajari.
10. **Aktifkan semi-auto** — AI siapkan draft, kamu approve/edit di **Inbox Review**. Saat **readiness** tinggi → AI **usulkan full-auto**.

## 6. Subsistem inti

**Ingestion (chat).** Adapter ganda → transcript seragam `{ts, sender(me/them), text}`:
- Live-pull: `engine.getChats` + `fetchMessages` per kontak/periode.
- File import: parser export WAnalysis (format diverifikasi via research spike — lihat §9).

**Learning.**
- *Voice Card*: LLM menganalisis pesan "me" → ekstrak nada, formalitas, emoji, sapaan/penutup, panjang, frasa khas. Hasil = profil editable yang masuk ke system prompt.
- *Q&A mining*: deteksi pasangan tanya(them)→jawab(me) berulang → kandidat Q&A untuk di-approve.
- *Docs → RAG*: chunk + embed; retrieval saat menjawab.
- *Images → katalog*: vision captioning → atribut produk.

**Runtime agent (reuse).** message:received → guard → retrieve (Q&A + RAG) → LLM (pakai Voice Card sebagai persona) → confidence → draft/kirim. Mode:
- `supervised`: simpan sebagai **draft**, tunggu approve/edit manusia.
- `auto`: kirim langsung (dengan guardrails).

**Active learning.** Tiap edit manusia di mode supervised = sinyal: perbaiki Q&A/voice, naikkan akurasi.

**Readiness → saran full-auto.** Skor dari approval-rate (berapa draft dikirim tanpa edit), coverage, confidence. Lewat ambang → AI usul "siap full-auto".

**Guardrails & privasi.** Anti-ban (delay manusiawi, cap harian, jam kerja), handoff ke manusia, enkripsi key, data chat tetap lokal (self-host).

## 7. Rebrand → AgentWA

Lapisan tema/branding tipis di atas fork (logo, nama, warna, judul dashboard) + build script — bukan ngedit dalam-dalam, biar masih bisa tarik update OpenWA.

## 8. Urutan build (bertahap menuju produk penuh)

- **F0 — Fondasi & rebrand:** kerangka modul backend + nav "AI Agent" + Onboarding wizard shell + rebrand dasar.
- **F1 — Connect & LLM:** langkah 1–4 (token, QR, LLM APImart+OpenRouter + tes).
- **F2 — Chat learning (centerpiece):** langkah 5–6 (ingestion ganda → Voice Card + Q&A mined → review UI). **Paling bernilai.**
- **F3 — Runtime semi-auto:** langkah 10 bagian supervised (Inbox Review, draft, approve/edit) pakai otak yang sudah ada + Voice Card.
- **F4 — Knowledge lanjut:** langkah 7–8 (docs RAG + katalog gambar).
- **F5 — Readiness → full-auto:** skoring + saran + mode auto.
- **F6 — Closing → order ke Scalev (IN-SCOPE, wajib dibangun):** bot menangkap order lengkap dari chat (slot-filling, voice natural) lalu membuat order di Scalev dengan kurir+ongkir otomatis; auto/supervised mengikuti mode. Aggregator pihak ketiga (Everpro/Mengantar/Lincah) **dibatalkan** — fulfillment lewat Scalev. Desain: `2026-06-28-watomatis-scalev-order-design.md`.

Tiap fase menghasilkan sesuatu yang bisa dipakai & dites.

## 9. Research spikes (harus dipastikan sebelum bangun bagian terkait)

1. **Format export WAnalysis** — pelajari output (txt/csv/json?) dari extension, untuk parser file-import. (User tawarkan cek di Chrome-nya, atau paste 1 sample.)
2. **Kemampuan history OpenWA** — sejauh apa `engine.fetchMessages` bisa tarik riwayat (kedalaman, performa) di whatsapp-web.js & baileys.
3. **Embedding/RAG** — provider embedding (APImart/OpenRouter punya? atau lokal) + vector store (mulai: tabel + cosine in-process; nanti pgvector).

## 10. Di luar scope sekarang

Aggregator pengiriman pihak ketiga (Everpro/Mengantar/Lincah — **dibatalkan**, fulfillment via Scalev), multi-tenant SaaS shell + billing, marketplace. Ditambahkan setelah inti chat matang.

> **Update 2026-06-28:** F6 (closing → order ke Scalev) dipindah dari "nanti" ke **in-scope dan wajib dibangun**. Lihat §8 F6 dan desain `2026-06-28-watomatis-scalev-order-design.md`.
