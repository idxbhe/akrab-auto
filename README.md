# Changelog Terbaru

Berikut adalah daftar 5 perubahan terakhir pada sistem Akrab Auto:

1. **Pembaruan UI Menu List (Satu Baris & Lebar)**  
   Memperpanjang garis pemisah antar pesanan dan menyatukan semua tombol aksi ke dalam satu baris horizontal agar tampilan lebih ramping dan luas.

2. **Pembaruan UI Menu List Minimalis**  
   Mengubah tombol pada menu "📋 List" menjadi hanya emoji agar lebih ramping dan menambahkan garis pemisah antar pesanan untuk tampilan yang lebih rapi.

3. **Informasi Ghost Stock pada Menu Cek Stok**  
   Memperbarui menu "📦 Cek Stok" agar menampilkan level stok hantu (jika ada) untuk memudahkan admin memantau stok palsu yang sedang di-blacklist oleh bot.

4. **Pengurangan Verbosity Log Terminal**  
   Menyembunyikan log rutin pengecekan stok dari terminal untuk mengurangi kebisingan, namun tetap mempertahankan log aktivitas transaksi penting.

5. **Penanganan Bug Ghost Stock Server**  
   Mengimplementasikan "Dynamic Ghost Stock Filtering" untuk mendeteksi stok palsu. Bot akan melewati eksekusi jika angka stok stagnan di level hantu yang terkonfirmasi, namun tetap mencoba jika angka stok berubah (naik/turun).
