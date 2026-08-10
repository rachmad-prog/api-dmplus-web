# Perubahan: Dukungan 1 API Key DOKU untuk Banyak Website

## Apa yang berubah
File `src/services/doku.js` — fungsi `createCheckoutPayment` sekarang mengirim
`additional_info.override_notification_url` di setiap request pembuatan
transaksi ke DOKU. Ini memaksa DOKU mengirim notifikasi pembayaran langsung
ke backend dmplus-web sendiri, terlepas dari Notification URL statis apa pun
yang di-set di DOKU Back Office (yang hanya bisa diisi 1 URL untuk seluruh
akun/API key).

Pola ini sama dengan yang sudah dipakai project zilapage yang berbagi API
key DOKU yang sama.

## Yang perlu kamu lakukan setelah upload/replace file ini

1. **Tambahkan environment variable baru** di Vercel dashboard project
   dmplus-web (Settings → Environment Variables):

   ```
   BACKEND_URL=https://<domain-backend-dmplus-web-kamu>
   ```

   Ganti dengan domain backend dmplus-web yang sebenarnya (yang melayani
   endpoint `/api/...`, bukan domain frontend React-nya).

2. **Pastikan `DOKU_CLIENT_ID` dan `DOKU_SECRET_KEY`** di dmplus-web sama
   persis dengan yang dipakai di project zilapage (1 API key yang sama).

3. Redeploy project dmplus-web setelah env var ditambahkan.

4. Tidak perlu ubah apa pun lagi di DOKU Back Office — Notification URL
   statis di sana boleh dibiarkan mengarah ke salah satu project saja
   (sebagai fallback), karena `override_notification_url` akan selalu
   diprioritaskan DOKU untuk setiap transaksi.

## Catatan keamanan
File `.env` **tidak disertakan** di dalam zip ini. Tambahkan `BACKEND_URL`
langsung ke `.env` lokal kamu atau ke Environment Variables di Vercel —
jangan commit `.env` ke repository publik.
