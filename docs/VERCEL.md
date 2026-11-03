# Vercel: preview website (belum tervalidasi di Vercel)

Vercel menyajikan file `public/` dan fungsi `api/proxy.mjs` meneruskan `/api/*` ke backend HTTPS terpisah. Ini bukan cara menjalankan server Node `npm start` sebagai proses permanen di Vercel. Konfigurasi dan rewrite belum diuji di deployment Vercel nyata. Tanpa backend, halaman publik tetap tersedia tetapi API mengembalikan 503 dan login/dashboard tidak berfungsi. Jangan gunakan akun asli atau uang nyata.

## Deploy frontend
1. Masuk ke Vercel, pilih **Add New → Project**, lalu hubungkan GitHub dan impor `HOOOOOOQ/kaixpallotp`.
2. Pilih branch produksi `main` pada pengaturan Git. Root Directory: root repository (`./`); Framework Preset: **Other**. Gunakan `vercel.json` di repository; jangan tetapkan build command atau output directory lain. Tidak ada build frontend yang perlu dijalankan.
3. Untuk preview halaman saja, biarkan `BACKEND_URL` kosong. Klik **Deploy**. Setelah selesai buka URL Vercel, periksa halaman utama, `/account`, `/dashboard`, `/developer` dan `/api/health` (tanpa backend, 503 adalah hasil yang diharapkan).
4. Perubahan berikutnya yang di-merge ke `main` biasanya memicu deployment produksi otomatis jika integrasi Git aktif. Konfirmasi lewat tab Deployments, bukan asumsi.

## Menghubungkan backend untuk pengujian terisolasi
1. Sediakan hosting Node.js permanen dengan HTTPS, serta database MySQL/MariaDB khusus pengujian. Backend saat ini belum siap produksi: migrasi, login, keamanan dan integrasi DB belum diuji dengan database sungguhan; login rate limit bersifat per-proses dan di belakang proxy dapat membatasi banyak pengguna sekaligus. Lakukan security review dan uji integrasi sebelum mengizinkan pengguna nyata.
2. Di hosting backend, atur `NODE_ENV=production`, `APP_ORIGIN=https://DOMAIN-VERCEL-ANDA` (origin persis, tanpa path), `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, dan `DB_TLS=true` jika database mendukung TLS terverifikasi. Jalankan `npm ci`, `npm run db:status` jika tabel migrasi sudah ada, dan `npm run migrate` pada database khusus yang telah dibackup. Jalankan `npm start` sebagai layanan permanen; penyedia hosting harus menyediakan TLS dan `PORT`.
3. Vercel → Project → **Settings → Environment Variables**: tambahkan `BACKEND_URL` = `https://DOMAIN-BACKEND-ANDA` (hanya origin HTTPS, tanpa path, kredensial atau slash tambahan), pilih environment **Production**, lalu lakukan redeploy. Nilai ini dikonsumsi server-side. Jangan memasukkan password database, API key, atau secrets ke Git atau ke kode browser.
4. Periksa `/api/health` melalui domain Vercel. Health hanya melaporkan kondisi aplikasi/database, bukan validasi integrasi. Uji register/login/logout dan halaman dashboard dengan akun uji pada database khusus. Pastikan cookie Secure, Origin/CSRF dan error ditangani benar. `APP_ORIGIN` hanya mengizinkan satu origin, sehingga preview URL lain perlu backend terpisah dengan origin yang sesuai; jangan melemahkan validasi untuk preview.
5. Worker `npm run worker` adalah proses terpisah yang opt-in, bukan Vercel Function; jangan aktifkan tanpa meninjau kebijakan retensi dan backup.

Pembelian, pembayaran, sinkronisasi Zyrex, dan verifikasi produksi belum tersedia/terverifikasi. Jangan aktifkan transaksi nyata. Jangan menyimpan kredensial dalam repository publik.
