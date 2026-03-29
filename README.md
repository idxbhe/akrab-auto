# Changelog Terbaru

Berikut adalah daftar 5 perubahan terakhir pada sistem Akrab Auto:

1. **Informasi Ghost Stock pada Menu Cek Stok**  
   Memperbarui menu "📦 Cek Stok" agar menampilkan level stok hantu (jika ada) untuk memudahkan admin memantau stok palsu yang sedang di-blacklist oleh bot.

2. **Pengurangan Verbosity Log Terminal**  
   Menyembunyikan log rutin pengecekan stok dari terminal untuk mengurangi kebisingan, namun tetap mempertahankan log aktivitas transaksi penting.

3. **Penanganan Bug Ghost Stock Server**  
   Mengimplementasikan "Dynamic Ghost Stock Filtering" untuk mendeteksi stok palsu. Bot akan melewati eksekusi jika angka stok stagnan di level hantu yang terkonfirmasi, namun tetap mencoba jika angka stok berubah (naik/turun).

4. **Implementasi Log Khusus API**  
   Menambahkan file `api.log` untuk mencatat semua respons dari server dan pesan webhook secara terpisah agar audit transaksi lebih mudah.

5. **Pengurangan Verbosity Log (Initial)**  
   Membersihkan `bot.log` dari pesan rutin "heartbeat" yang tidak perlu agar log lebih bersih dan fokus pada aktivitas penting.
