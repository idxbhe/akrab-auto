# Changelog Terbaru

Berikut adalah daftar 5 perubahan terakhir pada sistem Akrab Auto:

1. **Implementasi Log Khusus API**  
   Menambahkan file `api.log` untuk mencatat semua respons dari server dan pesan webhook secara terpisah agar audit transaksi lebih mudah.

2. **Pengurangan Verbosity Log**  
   Membersihkan `bot.log` dari pesan rutin "heartbeat" yang tidak perlu agar log lebih bersih dan fokus pada aktivitas penting.

3. **Optimasi Stok & Logika Retry Status**  
   Meningkatkan efisiensi pemakaian API stok dan menambahkan logika pengecekan status otomatis yang lebih detail (retry hingga 3 kali jika data tidak ditemukan).

4. **Perbaikan Background Checker**  
   Memperbaiki bug pada modul checker untuk memastikan pemantauan stok berjalan lebih stabil.

5. **Perbaikan Error Minor**  
   Melakukan perbaikan kecil pada beberapa bagian kode untuk meningkatkan stabilitas aplikasi secara keseluruhan.
