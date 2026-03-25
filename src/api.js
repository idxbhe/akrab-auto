const axios = require('axios');
const logger = require('./logger');
const dotenv = require('dotenv');
dotenv.config();

const API_KEY = process.env.API_KEY;

const api = axios.create({
    baseURL: 'https://panel.khfy-store.com',
    timeout: 30000
});

async function cekStock() {
    try {
        const response = await api.get('/api_v3/cek_stock_akrab');
        return response.data;
    } catch (error) {
        logger.error('Failed to cek stock', { message: error.message });
        throw error;
    }
}

async function doTransaksi(produk, tujuan, reff_id) {
    try {
        const response = await api.get('/api_v2/trx', {
            params: {
                api_key: API_KEY,
                produk,
                tujuan,
                reff_id
            }
        });
        return response.data;
    } catch (error) {
        logger.error('Failed to do transaksi', { message: error.message, produk, tujuan, reff_id });
        throw error;
    }
}

async function cekHistory(refid) {
    try {
        const response = await api.get('/api_v2/history', {
            params: {
                api_key: API_KEY,
                refid
            }
        });
        return response.data;
    } catch (error) {
        logger.error('Failed to cek history', { message: error.message, refid });
        throw error;
    }
}

module.exports = {
    cekStock, doTransaksi, cekHistory
};
