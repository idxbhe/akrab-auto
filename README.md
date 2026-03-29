# Changelog Terbaru

Berikut adalah daftar 5 perubahan terakhir pada sistem Akrab Auto:

1. **Penanganan Bug Ghost Stock Server**  
   Mengimplementasikan "Dynamic Ghost Stock Filtering" untuk mendeteksi stok palsu. Bot akan melewati eksekusi jika angka stok stagnan di level hantu yang terkonfirmasi, namun tetap mencoba jika angka stok berubah (naik/turun).

2. **Implementasi Log Khusus API**  
   Menambahkan file `api.log` untuk mencatat semua respons dari server dan pesan webhook secara terpisah agar audit transaksi lebih mudah.

3. **Pengurangan Verbosity Log**  
   Membersihkan `bot.log` dari pesan rutin "heartbeat" yang tidak perlu agar log lebih bersih dan fokus pada aktivitas penting.

4. **Optimasi Stok & Logika Retry Status**  
   Meningkatkan efisiensi pemakaian API stok dan menambahkan logika pengecekan status otomatis yang lebih detail (retry hingga 3 kali jika data tidak ditemukan).

5. **Perbaikan Background Checker**  
   Memperbaiki bug pada modul checker untuk memastikan pemantauan stok berjalan lebih stabil.
