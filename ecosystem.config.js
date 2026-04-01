module.exports = {
  apps: [
    {
      name: 'akrab-auto',
      script: 'index.js',
      // Wajib 1 instance untuk menghindari duplikasi eksekusi & konflik database file (lowdb)
      instances: 1,
      autorestart: true,
      watch: false,
      // Batas RAM dilonggarkan menjadi 1GB sesuai permintaan
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
        DEBUG: 'false'
      },
      // Mengarahkan log console ke file terpisah agar mudah dipantau lewat PM2
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      // Membaca file .env yang sudah ada secara otomatis
      dotenv_config_path: '.env'
    }
  ]
};
