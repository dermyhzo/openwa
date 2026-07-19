# Watomatis - Panduan Akses Setelah Pembayaran

Terima kasih sudah membeli Watomatis (Lifetime). Dokumen ini menjelaskan persis apa yang kamu terima dan cara mengaktifkannya sampai bot balas chat pertama.

## Yang kamu terima

1. **Dokumen ini** (dikirim otomatis ke email kamu oleh sistem pembayaran).
2. **Kode lisensi** berformat `WTM1.xxxxx.xxxxx`, dikirim otomatis ke **nomor WhatsApp yang kamu isi saat checkout**, biasanya dalam 5-15 menit setelah pembayaran terverifikasi.
   Belum terima dalam 30 menit? Chat kami di WhatsApp 0831-8392-9631, sebutkan nomor HP/email yang dipakai saat checkout.

## Yang perlu disiapkan

- Laptop atau PC yang menyala saat bot bekerja: macOS, Linux, atau Windows (Windows perlu WSL2, panduannya ada di link di bawah).
- Aplikasi gratis **Docker Desktop** (https://www.docker.com/products/docker-desktop/).
- Nomor WhatsApp khusus untuk CS toko kamu (sangat disarankan bukan nomor pribadi utama).
- **API key AI (bayar sendiri, murah)**: Watomatis memakai "otak" AI dari penyedia pihak ketiga. Daftar di https://apimart.ai (atau openrouter.ai), beli kredit secukupnya. Dengan model hemat (gpt-4o-mini), biaya kira-kira Rp15-40 per balasan chat.

## Cara install (sekali saja)

Buka Terminal (di Windows: terminal WSL2/Ubuntu), lalu jalankan:

```
git clone https://github.com/dermyhzo/openwa ~/watomatis && bash ~/watomatis/install.sh
```

Tunggu sampai selesai (3-10 menit tergantung internet). **Di akhir proses, layar menampilkan API key login kamu. Simpan key itu.**

## Aktivasi (5 menit)

1. Buka dashboard di browser: `http://localhost:2785`
2. Login pakai API key yang muncul di akhir install.
3. Menu **License**: tempel kode lisensi `WTM1...` dari WhatsApp, klik **Aktifkan**.
4. Menu **Sessions**: buat sesi baru, **scan QR** pakai WhatsApp nomor CS kamu (seperti WhatsApp Web).
5. Menu **AI Agent**: isi API key AI (dari apimart.ai/openrouter), pilih model (saran: gpt-4o-mini), lalu ikuti panduan belajar gaya chat.

Panduan lengkap + tips: https://github.com/dermyhzo/openwa/blob/main/docs/watomatis/INSTALL.md

## Penting untuk diketahui (jujur dari kami)

- Watomatis memakai jalur WhatsApp tidak resmi (seperti semua tool sejenis). Ada risiko nomor dibatasi oleh WhatsApp. Pakai nomor khusus CS, aktifkan jeda balas di pengaturan, dan hindari spam. Risiko ini di luar kendali kami.
- Balasan AI dihasilkan lewat penyedia AI pihak ketiga pilihanmu; isi chat pelanggan dikirim ke penyedia itu untuk dibalas. Data lain tersimpan di komputermu sendiri.
- Kendala teknis? Support via WhatsApp 0831-8392-9631 sampai jalan.
