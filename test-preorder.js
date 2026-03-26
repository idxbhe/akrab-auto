const db = require('./src/db');
db.get('preorders').push({
  "id": "123456789",
  "nomor": "081234567890",
  "kode_produk": "XLA51",
  "nama_produk": "Jumbo V2",
  "status": "pending",
  "reff_id": "081234567890-XLA51-JumboV2-abcdef",
  "trx_id": "",
  "keterangan": "",
  "created_at": new Date().toISOString()
}).write();
