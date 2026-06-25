# Watomatis: Ready-to-Sell Audit

Status jujur kesiapan jual. Watomatis adalah produk **self-hosted**: dipasang di komputer klien, datanya tetap di klien. Dokumen ini memetakan apa yang **sudah siap** dan apa yang **masih perlu** sebelum dijual luas.

Tanggal audit: 2026-06-25.

## Ringkasan

Inti produk + monetisasi sudah jalan dan terverifikasi lokal: harga lisensi baru, penguncian fitur tanpa lisensi (UI + runtime), installer satu-perintah, dan landing page. Yang tersisa sebagian besar urusan **operator** (kunci Duitku produksi + URL publik untuk callback) dan **pengerasan anti-bypass** karena sifatnya self-hosted.

## Sudah siap (dikerjakan sesi ini, terverifikasi)

| Area | Status | Bukti |
|---|---|---|
| Harga lisensi 4 tier | DONE | Bulanan Rp25.000 / 6 Bulan Rp125.000 / Tahunan Rp200.000 / Lifetime Rp499.000. Tampil benar di halaman License (live :2785). |
| Lifetime = sekali bayar, tak pernah expired | DONE | plans.ts durationDays null, isActive() true selamanya untuk lifetime (unit test). |
| Penguncian fitur tanpa lisensi (UI) | DONE | Halaman AI Agent menampilkan banner "License not active, fitur terkunci" + tombol kontrol disabled (live :2785). |
| Penguncian fitur tanpa lisensi (server) | DONE | watomatis-runtime onMessage cek LicenseService.isActive(); tanpa lisensi aktif tidak ada auto-reply / draft. 19 unit test hijau (no-license / aktif / lifetime / expired). |
| Status API | DONE | GET /api/license/status -> { active, tier, lifetime, expiresAt }. |
| Installer turnkey | DONE | install.sh satu perintah (cek Docker, generate WATOMATIS_SECRET, `docker compose up -d --build`, tunggu health). Diuji: container up, /api/health/ready 200. |
| Panduan install klien | DONE | docs/watomatis/INSTALL.md (prasyarat, 1 perintah, update/stop/troubleshoot, plus opsi "install via AI agent"). |
| Landing page | DONE (polish in progress) | landing/index.html, premium, copy Indonesia, 4 harga. Lulus QC copy/struktur; perbaikan menu mobile + ikon sedang dikerjakan. |
| Fitur produk inti | DONE | Belajar gaya CS dari chat, balasan natural, supervised->auto, cek ongkir (api.co.id), anti-ban (delay/cap/jam kerja), brand docs + katalog, enkripsi API key at-rest. |

## Masih perlu sebelum jual (ranked)

1. **Setup pembayaran operator (BLOKER untuk transaksi nyata).** Duitku saat ini sandbox. Untuk jual betulan operator harus: isi `DUITKU_MERCHANT_CODE` + `DUITKU_MERCHANT_KEY` produksi, dan sediakan `PUBLIC_BASE_URL` HTTPS publik agar callback Duitku masuk (mis. VPS kecil atau tunnel tetap). Tanpa ini, pembayaran lifetime/langganan tidak bisa mengaktifkan lisensi di mesin klien.
   - Catatan arsitektur: karena instance ada di PC klien (sering tanpa IP publik), callback Duitku idealnya masuk ke **satu license-server milik operator**, lalu instance klien menarik status lisensinya dari sana. Lihat poin 2.
2. **Anti-bypass lisensi (PENTING untuk integritas monetisasi).** Gating sekarang lokal: kalau klien teknis mengedit kode, gate bisa dilepas. Untuk produk berbayar self-hosted, tambahkan **validasi phone-home**: instance memanggil license-server operator (cek token + status aktif) secara berkala; fitur mati kalau token invalid/kadaluarsa. Plus build terdistribusi (image, bukan source mentah) agar tidak gampang dipatch. Status sekarang: cukup untuk klien jujur, belum tahan klien nakal.
3. **Distribusi.** install.sh meng-clone repo. Untuk produk berbayar jangan bagikan source penuh bebas. Pilihan: publish image ke registry (Docker Hub privat / GHCR) lalu installer `pull` image + token; atau rilis terpaket. Tentukan kanal distribusi + lisensi kode.
4. **Hosting landing page + sambungkan CTA.** landing/index.html masih file statis dengan CTA placeholder. Host di domain operator (Vercel/Netlify/VPS) dan arahkan tombol harga ke checkout Duitku asli atau alur kontak (wa.me). Tambah favicon + meta OG.
5. **HTTPS + hardening prod.** Dashboard jalan di http://localhost:2785 (oke untuk single-user lokal). Kalau diekspos ke jaringan, butuh TLS + ganti `WATOMATIS_SECRET` kuat (installer sudah generate otomatis). Pertimbangkan Postgres untuk multi-instance operator (klien single tetap SQLite).
6. **Risiko ToS / ban WhatsApp.** Engine whatsapp-web.js tidak resmi; ada risiko nomor diblokir. Sudah ada fitur anti-ban (delay manusiawi, cap harian, jam kerja). Cantumkan disclaimer + best practice ke klien (pakai nomor khusus, jangan blast).
7. **Onboarding + support.** INSTALL.md ada. Tambah: video/gif scan QR, FAQ pembayaran, kontak support, kebijakan refund.

## Referensi harga (terpasang)

| Tier | Harga | Durasi | Catatan |
|---|---|---|---|
| Bulanan | Rp25.000 | 30 hari | langganan |
| 6 Bulan | Rp125.000 | 180 hari | langganan |
| Tahunan | Rp200.000 | 365 hari | langganan, "paling populer" |
| Lifetime | Rp499.000 | selamanya | sekali bayar, Best Value |

## Verdict

**Bisa demo + jual terbatas sekarang** (lokal/manual aktivasi). **Untuk jual skala** selesaikan poin 1 (pembayaran prod) dan poin 2 (anti-bypass) dulu, itu dua hal yang langsung menyentuh apakah uang masuk dan apakah lisensi benar-benar mengunci.
