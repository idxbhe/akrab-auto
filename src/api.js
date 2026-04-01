const axios = require('axios');
const logger = require('./logger');
const dotenv = require('dotenv');
dotenv.config();

const API_KEY = process.env.API_KEY;

const api = axios.create({
    baseURL: 'https://panel.khfy-store.com',
    timeout: 30000
});

// Map to store request log promises to allow response to reply to request message
const requestLogMap = new Map();

api.interceptors.request.use((config) => {
    // Skip logging for stock check endpoint to avoid spam
    if (config.url && config.url.includes('cek_stock_akrab')) {
        return config;
    }

    // We need the bot instance for notifier
    const bot = require('./bot');
    const { notifyApiLogRequest } = require('./notifier');

    // File logging (Automatic for non-stock check)
    logger.logApi(`REQUEST ${(config.method || 'GET').toUpperCase()} ${config.url}`, config.params);

    const requestId = Date.now() + Math.random();
    config.requestId = requestId;

    // Fire and forget (asynchronous Telegram log)
    const logPromise = notifyApiLogRequest(bot, config);
    requestLogMap.set(requestId, logPromise);

    // Cleanup map after 1 minute to prevent memory leaks
    setTimeout(() => requestLogMap.delete(requestId), 60000);

    return config;
}, (error) => {
    return Promise.reject(error);
});

api.interceptors.response.use((response) => {
    // Skip logging for stock check endpoint
    if (response.config.url && response.config.url.includes('cek_stock_akrab')) {
        return response;
    }

    const bot = require('./bot');
    const { notifyApiLogResponse } = require('./notifier');

    // File logging (Automatic)
    logger.logApi(`RESPONSE ${response.config.url}`, response.data);

    const requestId = response.config.requestId;
    const requestMsgPromise = requestLogMap.get(requestId);

    if (requestMsgPromise) {
        // Fire and forget
        notifyApiLogResponse(bot, response, requestMsgPromise).then(() => {
            requestLogMap.delete(requestId);
        });
    }

    return response;
}, (error) => {
    // Skip logging for stock check endpoint even on error if it's not critical
    if (error.config && error.config.url && error.config.url.includes('cek_stock_akrab')) {
        return Promise.reject(error);
    }

    const bot = require('./bot');
    const { notifyApiLogResponse } = require('./notifier');

    // File logging for error (Automatic)
    if (error.response) {
        logger.logApi(`ERROR_RESPONSE ${error.config ? error.config.url : 'unknown'}`, error.response.data);
    }

    if (error.config && error.config.requestId) {
        const requestId = error.config.requestId;
        const requestMsgPromise = requestLogMap.get(requestId);
        
        if (requestMsgPromise) {
            // Even on error, log the response/error data to Telegram
            notifyApiLogResponse(bot, error.response, requestMsgPromise).then(() => {
                requestLogMap.delete(requestId);
            });
        }
    }

    return Promise.reject(error);
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
