/**
 * Utility functions for Akrab Auto Bot
 */

/**
 * Generate a unique Reff ID for transactions
 * @param {string} nomor - Destination number
 * @param {string} kode_produk - Product code (e.g., XLA39)
 * @param {string} nama_produk - Product name (e.g., Big)
 * @returns {string}
 */
function generateReffId(nomor, kode_produk, nama_produk) {
    const uid = Math.random().toString(36).substring(2, 8);
    // Remove spaces from product name for cleaner ID
    const cleanProdName = (nama_produk || '').replace(/\s+/g, '');
    return `${nomor}-${kode_produk}-${cleanProdName}-${uid}`;
}

module.exports = {
    generateReffId
};
