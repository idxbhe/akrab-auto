# Changelog Terbaru

Berikut adalah daftar 5 perubahan terakhir pada sistem Akrab Auto:

1. **Pembaruan UI Cek Stok (Monospace & Code Block)**  
   Mempercantik tampilan "📦 Cek Stok" dengan font monospace untuk daftar stok agar sejajar dan membungkus catatan ghost stock ke dalam blok kode agar lebih profesional.

2. **Perbaikan Logika Tombol Retry**  
   Mengembalikan fungsi tombol Retry (♻️) agar hanya muncul pada pesanan dengan status ERROR, memastikan konsistensi alur kerja manual.

3. **Pembaruan UI Menu List (Satu Baris & Lebar)**  
   Memperpanjang garis pemisah antar pesanan dan menyatukan semua tombol aksi ke dalam satu baris horizontal agar tampilan lebih ramping dan luas.

4. **Informasi Ghost Stock pada Menu Cek Stok**  
   Memperbarui menu "📦 Cek Stok" agar menampilkan level stok hantu (jika ada) untuk memudahkan admin memantau stok palsu yang sedang di-blacklist oleh bot.

5. **Pengurangan Verbosity Log Terminal**  
   Menyembunyikan log rutin pengecekan stok dari terminal untuk mengurangi kebisingan, namun tetap mempertahankan log aktivitas transaksi penting.
