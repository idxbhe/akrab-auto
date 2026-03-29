# Changelog Terbaru

Berikut adalah daftar 5 perubahan terakhir pada sistem Akrab Auto:

1. **Pengurangan Verbosity Log Terminal**  
   Menyembunyikan log rutin pengecekan stok dari terminal untuk mengurangi kebisingan, namun tetap mempertahankan log aktivitas transaksi penting.

2. **Penanganan Bug Ghost Stock Server**  
   Mengimplementasikan "Dynamic Ghost Stock Filtering" untuk mendeteksi stok palsu. Bot akan melewati eksekusi jika angka stok stagnan di level hantu yang terkonfirmasi, namun tetap mencoba jika angka stok berubah (naik/turun).

3. **Implementasi Log Khusus API**  
   Menambahkan file `api.log` untuk mencatat semua respons dari server dan pesan webhook secara terpisah agar audit transaksi lebih mudah.

4. **Pengurangan Verbosity Log (Initial)**  
   Membersihkan `bot.log` dari pesan rutin "heartbeat" yang tidak perlu agar log lebih bersih dan fokus pada aktivitas penting.

5. **Optimasi Stok & Logika Retry Status**  
   Meningkatkan efisiensi pemakaian API stok dan menambahkan logika pengecekan status otomatis yang lebih detail (retry hingga 3 kali jika data tidak ditemukan).
