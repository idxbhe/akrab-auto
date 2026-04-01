#!/bin/bash

# Pastikan PM2 terinstall secara global jika belum ada
if ! command -v pm2 &> /dev/null
then
    echo "PM2 tidak ditemukan. Menginstall PM2..."
    npm install pm2 -g
fi

# Jalankan bot menggunakan konfigurasi ecosystem dalam mode production
echo "Memulai Akrab Auto Bot dengan PM2..."
pm2 start ecosystem.config.js --env production

# Tampilkan status bot
pm2 status akrab-auto

echo "-------------------------------------------------------"
echo "Bot sedang berjalan di background (PM2)."
echo "Gunakan 'pm2 logs akrab-auto' untuk melihat aktivitas."
echo "-------------------------------------------------------"
