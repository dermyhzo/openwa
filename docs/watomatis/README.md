# Watomatis — Setup & Fitur

AI customer-service WhatsApp yang **belajar gaya CS-mu dari chat asli**, jalan **semi-otomatis → full-otomatis**, dengan **cek ongkir** dan **lisensi via Duitku**. Dibangun di atas fork OpenWA (self-hosted).

## Fitur yang sudah ada
- **Belajar dari chat** → Voice Card (gaya bicara) + Q&A. Dua sumber: **upload export** (WAnalysis CSV) atau **tarik langsung dari WhatsApp** yang tersambung.
- **Auto-reply** natural & kontekstual (bukan template), sadar waktu, pakai gaya hasil belajar.
- **Mode**: `off` · `supervised` (bikin draft buat di-approve di menu **Drafts**) · `auto` (balas sendiri).
- **Active learning**: tiap Q&A nyata terekam → menu **Learning** → "Update knowledge" → makin pinter. **Readiness** menyarankan naik ke full-auto.
- **Cek ongkir** (api.co.id, BYOT): deteksi pertanyaan ongkir → resolve kelurahan+kota → harga kurir real-time di balasan.
- **Brand docs + katalog produk** masuk ke jawaban bot.
- **Anti-ban**: delay manusiawi, cap harian, jam kerja.
- **Lisensi/monetisasi** via **Duitku** (menu **License**): status + bayar/perpanjang.
- **Keamanan**: API key dienkripsi at-rest (AES-256-GCM).

## Halaman dashboard (http://localhost:2785)
**Get Started** (checklist) · **Sessions** (scan QR) · **AI Agent** (belajar + Activate) · **Drafts** · **Learning** · **License** · Plugins, dll.

## Konfigurasi `.env` (taruh di root repo, dibaca docker-compose.dev.yml)
```env
# Fix WhatsApp Web stall di Apple Silicon (sudah dipakai)
WWEBJS_WEB_VERSION=2.3000.1023204257

# Enkripsi API key tersimpan — WAJIB ganti di produksi
WATOMATIS_SECRET=ganti-dengan-string-acak-panjang

# Lisensi via Duitku (BYOT — akun Duitku-mu)
DUITKU_MERCHANT_CODE=DXXXX
DUITKU_MERCHANT_KEY=xxxxxxxx
DUITKU_ENV=sandbox            # atau production
# Callback Duitku butuh URL publik (pakai tunnel saat lokal):
#   ngrok http 2785  →  PUBLIC_BASE_URL=https://xxxx.ngrok.io
PUBLIC_BASE_URL=http://localhost:2785
```

## BYOT (Bring Your Own Token) — diisi di dashboard, bukan .env
- **LLM**: APImart atau OpenRouter (key di halaman AI Agent).
- **Cek ongkir**: api.co.id key (di kartu Activate → Shipping).
- **Lisensi**: Duitku (lihat .env di atas — ini punya operator/pemilik produk).

## Alur pakai singkat
1. **Sessions** → scan QR (sambungkan WhatsApp).
2. **AI Agent** → isi LLM key → **Learn** (upload export / tarik dari WA) → cek Voice Card + Q&A.
3. Kartu **Activate** → pilih nomor + **mode** (mulai `supervised`) → (opsional) shipping, brand docs, produk, guardrails → **Save & activate**.
4. Pantau di **Drafts**; saat **Learning** bilang siap → ganti mode ke `auto`.

> Catatan: tiap rebuild container kadang bikin linked-device WhatsApp putus → scan QR ulang di Sessions. Set `.env` lalu `docker compose -f docker-compose.dev.yml up -d --build`.
