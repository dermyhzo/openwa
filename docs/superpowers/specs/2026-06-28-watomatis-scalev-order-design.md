# Watomatis F6 — Order ke Scalev (design)

**Tanggal:** 2026-06-28
**Status:** Approved — siap ditulis implementation plan
**Konteks:** Mewujudkan **F6** dari `2026-06-23-agentwa-product-spec.md` (sebelumnya "di luar scope"). Sekarang **in-scope dan wajib dibangun.** Aggregator pengiriman Everpro dibatalkan (kredensial sulit didapat); fulfillment lewat **Scalev** (order + shipping ditangani Scalev).

---

## 1. Tujuan

Saat percakapan WhatsApp menuju closing, bot **menangkap order lengkap** dari chat (voice natural, bukan form kaku), lalu **membuat order di Scalev** dengan kurir + ongkir terisi otomatis. Order langsung muncul di sistem Scalev operator, siap diproses.

**Definisi sukses:**
- Bot mengumpulkan slot order wajib lintas-giliran sampai lengkap, tetap dalam gaya CS hasil belajar.
- `mode=auto` → order otomatis dibuat di Scalev + bot konfirmasi (no order + total + ongkir). `mode=supervised` → "booking draft" menunggu approve operator di dashboard, baru dikirim ke Scalev.
- Kurir dipilih otomatis (termurah; hormati preferensi pelanggan bila disebut), best-effort.
- Tidak pernah mengarang nomor order / sukses palsu saat Scalev gagal.

## 2. Non-goals (sengaja di luar scope ini)

- Webhook/polling status order (Scalev webhook diatur di dashboard mereka, bukan API ini).
- Multi-store per instance (satu `store_unique_id` per instance dulu).
- Cron sync katalog otomatis (sync manual via tombol).
- Aggregator pengiriman pihak ketiga (Everpro/Mengantar/Lincah).
- Mengganti cek-ongkir `api.co.id` yang sudah ada (tetap dipakai untuk quote cepat di chat, tidak disentuh).
- Pembuatan produk/varian/landing page di Scalev (read + create order saja).

## 3. Keputusan terkunci

| Hal | Pilihan |
|---|---|
| Fulfillment backend | **Scalev** (`POST /order`), bukan Everpro |
| Autonomy | **Ikut mode agent** — auto = buat order + kirim resi/konfirmasi; supervised = booking draft → approve |
| Order capture | **Full** — kejar semua slot wajib sampai lengkap |
| Pembayaran | **COD + transfer** (Scalev `cod` \| `bank_transfer`) |
| Mapping produk | **Sync katalog dari Scalev** (`GET /products` → `variant_unique_id` + harga + berat) |
| Pilih kurir | **Otomatis termurah**, override bila pelanggan menyebut kurir; best-effort (gagal → order tetap dibuat tanpa kurir) |

## 4. Kontrak Scalev API yang dipakai

Base `https://api.scalev.id/v2`, auth `Authorization: Bearer <SCALEV_API_KEY>`, response dibungkus `{code, status, data}`. Rate limit 10.000/jam.

| Kebutuhan | Endpoint |
|---|---|
| List store (pilih store + warehouse) | `GET /stores`, `GET /stores/{id}` |
| Sync katalog (varian + harga + berat) | `GET /products` (paginate, flatten `variants[]`) |
| Resolve tujuan | `GET /locations?search=` → `location_id` |
| Ongkir + kurir | `GET /shipping/costs?warehouse_id=&location_id=&weight=&courier_service_id=` |
| Buat order | `POST /order` |

**`POST /order` payload (yang kita isi):**
`store_unique_id` (wajib), `customer_name` (wajib), `customer_phone`, `address`, `postal_code`, `location_id`, `ordervariants[{variant_unique_id, quantity}]`, `payment_method` (`cod`|`bank_transfer`), `courier_service_id`, `shipment_provider_code`, `shipping_cost`, `notes`, `metadata`.

> Catatan jebakan umum: `POST /order` minta `variant_unique_id` (string UUID), bukan integer `id`.

## 5. Arsitektur

Menambah subsistem **order** di modul `watomatis` yang sudah ada. Pendekatan: **slot-filling pada satu LLM call balasan yang sudah ada** (bukan call kedua) → order-draft per chat → aksi booking digerbang `mode`. Pipeline balasan/Drafts lama tetap utuh; order capture bersifat aditif.

```
message:received
  └─ WatomatisRuntime.onMessage  (license gate, mode gate — sudah ada)
       ├─ generateReply()  → LLM → { reply, canAnswer, order? }     (envelope diperluas)
       ├─ OrderStore.merge(chatId, order)  → akumulasi slot           (baru)
       └─ if order.readyToBook && slot lengkap:
            ├─ resolve location_id  (ScalevConnector.searchLocation)  (baru)
            ├─ total berat = Σ weightGram×qty  (dari katalog sync)
            ├─ shippingCosts() → pilih kurir (termurah / preferensi)  (baru)
            ├─ mode=auto      → ScalevConnector.createOrder() → konfirmasi
            └─ mode=supervised→ OrderStore.markReady() (tunggu approve dashboard)
```

## 6. Komponen

### 6.1 `connectors/scalev.connector.ts` (@Injectable)
Pola sama `shipping.connector.ts`: BYOT key di-pass masuk, `fetch` + timeout, unwrap `{code,data}`, **return `{error}` bukan throw**. Method seperlunya:
- `listStores(key)` → `[{id, name, uniqueId, warehouses:[{id, uniqueId, name}]}]`
- `listProducts(key)` → flatten → `[{name, variantUniqueId, price, weightGram}]`
- `searchLocation(key, query)` → `[{locationId, label}]`
- `shippingCosts(key, {warehouseId, locationId, weight, courierServiceId?})` → `[{courierServiceId, courierName, shipmentProviderCode, price, etd}]`
- `createOrder(key, payload)` → `{orderId, status}` atau `{error}`

### 6.2 Settings global (reuse `WatomatisSettingsStore`, sudah AES-256-GCM)
Field baru: `scalevEnabled` (bool), `scalevApiKey` (enkripsi), `scalevStoreUniqueId`, `scalevWarehouseUniqueId` (+ `scalevWarehouseId`), `scalevCatalog` (`[{name, ref, price, weightGram, variantUniqueId}]`). Diekspos lewat `GET/PUT /watomatis/settings` yang sudah ada (key tidak pernah dikirim balik mentah).

### 6.3 Sync katalog
Tombol di Settings → `POST /watomatis/scalev/sync-catalog` → `listProducts()` → simpan ke `scalevCatalog` dengan `ref` stabil (`P1`,`P2`,…). `ref` + nama + harga diumpankan ke prompt balasan (reuse opsi `products` di `buildReplyPrompt`, sehingga harga yang disebut bot selalu sinkron). `variantUniqueId` disimpan server-side untuk create order — LLM hanya menyebut `ref`.

### 6.4 Order capture — perluas envelope LLM
`buildReplyPrompt` + parsing di `generateReply` menambah objek `order` (semua opsional, model isi sebisanya):
```ts
order?: {
  intent: boolean;          // pelanggan sedang mau beli
  readyToBook: boolean;     // semua slot wajib ada + pelanggan konfirmasi
  customerName?: string;
  phone?: string;
  address?: string;
  postalCode?: string;
  city?: string;            // untuk resolve location_id
  paymentMethod?: 'cod' | 'transfer';
  courierPreference?: string;   // kalau pelanggan menyebut kurir
  items?: { ref: string; quantity: number }[];   // ref dari KATALOG
}
```
Prompt diinstruksikan: kenali produk dari KATALOG (pakai `ref`), kumpulkan slot kurang **dengan voice natural**, set `readyToBook=true` hanya saat `customerName + phone + address + postalCode + city + items + paymentMethod` lengkap dan pelanggan setuju. Jangan mengarang slot.

### 6.5 `watomatis-order-store.service.ts` (SQLite, pola `watomatis-drafts.service.ts`)
Satu record per `(sessionId, chatId)` aktif, akumulasi slot lintas-giliran:
```
{ id, sessionId, chatId, customerName?, phone?, address?, postalCode?, city?,
  paymentMethod?, courierPreference?, items: [{ref, quantity}],
  status: 'collecting' | 'ready' | 'booked' | 'failed',
  scalevOrderId?, lastError?, createdAt, updatedAt }
```
`merge(chatId, partial)` menimpa hanya field yang dikirim (non-null), append/replace items. Persist (tahan restart container).

### 6.6 Booking di `WatomatisRuntime`
Setelah merge, jika `readyToBook` & slot wajib lengkap:
1. `searchLocation(city || address)` → `location_id` (ambil match terbaik).
2. total berat = Σ(`weightGram` × qty) dari `scalevCatalog` via `ref`.
3. `shippingCosts({warehouseId, locationId, weight})` → kalau `courierPreference` cocok & tersedia pakai itu, kalau tidak **pilih termurah**.
4. Susun payload, map `ref` → `variantUniqueId`, `paymentMethod` → `cod|bank_transfer`.
5. **mode=auto**: `createOrder()`. Sukses → `status=booked`, simpan `scalevOrderId`, tambahkan konfirmasi (no order + total + ongkir+kurir) ke balasan. Gagal → `status=failed`, `lastError`, **fallback** (jangan klaim sukses / jangan karang no order).
6. **mode=supervised**: `status=ready` (tidak memanggil Scalev); muncul di dashboard Orders untuk di-approve. Bot tetap membalas natural seperti biasa, **tanpa** mengirim nomor order/konfirmasi (belum dibuat). Saat operator klik approve (`POST /orders/:id/book`), langkah 1–5 (resolve `location_id` + berat + pilih kurir + `createOrder`) dijalankan **saat itu** dengan data terbaru.

**Order berikutnya:** satu record aktif per `(sessionId, chatId)`. Setelah `booked`, intent beli baru dari chat yang sama memulai record order baru.

**Best-effort kurir:** kalau `shippingCosts` kosong/gagal → tetap `createOrder()` tanpa `courier_service_id`/`shipping_cost` (order masuk status "new"), `notes` menandai "ongkir/kurir belum, finalisasi di Scalev". Jualan tidak pernah diblok ongkir.

### 6.7 Dashboard
Halaman **Orders** baru (route `orders` + item nav): daftar order per chat + status, field tertangkap, untuk `ready` ada tombol **"Kirim ke Scalev"**; tampilkan `scalevOrderId` saat `booked`, `lastError` saat `failed`. Kartu **Scalev / Order** di halaman Shipping settings: API key, dropdown store (auto-ambil warehouse), toggle enable, tombol **Sync katalog**.

### 6.8 Endpoint controller (`watomatis.controller.ts`)
- `GET /watomatis/orders` — list order
- `POST /watomatis/orders/:id/book` — approve (supervised) → createOrder
- `DELETE /watomatis/orders/:id`
- `POST /watomatis/scalev/sync-catalog`
- `GET /watomatis/scalev/stores` — untuk dropdown settings
- (settings via `PUT /watomatis/settings` yang ada)

Semua endpoint baru + jalur booking runtime **digerbang `LicenseService.isActive()`** (fitur premium), konsisten dengan runtime sekarang.

## 7. Error handling & integritas

- Connector tidak pernah throw ke runtime → `{error}`; runtime log + lanjut, tidak pernah crash hook.
- Scalev gagal di auto mode → fallback message, `status=failed`, **tidak ada konfirmasi/nomor palsu** (sejalan commit `988ffb8`).
- Key Scalev tidak pernah dikirim balik mentah dari `GET /settings`.
- 401/400 dari Scalev → simpan `lastError` ringkas untuk operator, jangan bocor ke pelanggan.

## 8. Testing (colocated `*.spec.ts`, Jest)

- `scalev.connector.spec.ts` — mock `fetch`: parse `listProducts`/`searchLocation`/`shippingCosts`, payload `createOrder` benar (pakai `variant_unique_id`), unwrap `{code,data}`, jalur `{error}` saat non-OK / `code!=200`.
- `watomatis-order-store.spec.ts` — `merge` menimpa hanya field terkirim, append items, transisi status `collecting→ready→booked/failed`.
- `reply-prompt.spec.ts` — envelope `order` dijelaskan + katalog `ref` terinjeksi saat ada `scalevCatalog`.
- runtime/order spec — booking dipanggil hanya saat `readyToBook` + slot lengkap; auto vs supervised (auto memanggil createOrder, supervised tidak); pilih kurir termurah; preferensi dihormati; best-effort saat shippingCosts kosong; gate lisensi.

## 9. Penyederhanaan (ponytail, sengaja)

- Tanpa webhook/polling status.
- Satu store per instance.
- Sync katalog manual (tombol), bukan cron.
- `location_id` best-effort single match; ambigu/none → order tetap dibuat, operator rapikan.
- Kurir default termurah; "kurir favorit operator" preset menyusul bila perlu.

## 10. Kredensial untuk tes live (sudah dikonfirmasi tersedia)

`SCALEV_API_KEY` (dashboard Scalev → Settings → API Keys). Operator pilih store di Settings; warehouse + katalog di-resolve dari Scalev. Tidak ada `.env` baru (key disimpan terenkripsi via settings, seperti key lain).

## 11. Urutan build (untuk implementation plan)

1. `ScalevConnector` + spec (listStores, listProducts, searchLocation, shippingCosts, createOrder).
2. Settings: field Scalev + endpoint stores + sync-catalog.
3. `OrderStore` + spec (merge/status).
4. Perluas `buildReplyPrompt` + parsing envelope `order` + injeksi katalog `ref`.
5. Booking di `WatomatisRuntime` (resolve location, weight, pilih kurir, auto/supervised) + spec.
6. Endpoint orders (list/book/delete) + gate lisensi.
7. Dashboard: halaman Orders + kartu Scalev di Settings.
8. Build + smoke test live (sandbox/akun Scalev): supervised dulu (lihat order draft → approve → muncul di Scalev), lalu auto.
