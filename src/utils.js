const fs = require('fs');
const path = require('path');

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

/**
 * Parse log date format [DD:MM:YYYY - HH:mm] to Date object
 * @param {string} dateStr 
 * @returns {Date}
 */
function parseLogDate(dateStr) {
    try {
        const [datePart, timePart] = dateStr.split(' - ');
        const [day, month, year] = datePart.split(':');
        const [hour, min] = timePart.split(':');
        return new Date(year, month - 1, day, hour, min);
    } catch (e) {
        return new Date(0);
    }
}

/**
 * Get API Request/Response pairs for a specific number from logs
 * @param {string} nomor - Destination number to track
 * @param {Date|string} startTime - Only track logs after this time
 * @returns {Array<Object>} - Array of pairs { request, response }
 */
function getTrackData(nomor, startTime = null) {
    const apiLogFile = path.join(__dirname, '..', 'logs', 'api.log');
    if (!fs.existsSync(apiLogFile)) return [];

    const threshold = startTime ? new Date(new Date(startTime).getTime() - 60000) : new Date(0);

    try {
        const content = fs.readFileSync(apiLogFile, 'utf8');
        const lines = content.split('\n');
        
        let blocks = [];
        let currentBlock = null;

        // Group lines into blocks
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('[') && line.includes('[API]')) {
                // Check if this block is within time threshold
                const dateMatch = line.match(/\[(.*?)\]/);
                if (dateMatch) {
                    const blockDate = parseLogDate(dateMatch[1]);
                    if (blockDate < threshold) {
                        currentBlock = null;
                        continue;
                    }
                }

                if (currentBlock) blocks.push(currentBlock);
                currentBlock = { header: line, dataLines: [] };
            } else if (currentBlock) {
                currentBlock.dataLines.push(line);
            }
        }
        if (currentBlock) blocks.push(currentBlock);

        // Map blocks to pairs (Request -> Response)
        let pairs = [];
        let reffIds = new Set();

        // 1. Find all Reff IDs for this number in the filtered blocks
        blocks.forEach(b => {
            if (b.header.includes('REQUEST') && b.header.includes('/api_v2/trx')) {
                const dataStr = b.dataLines.join('\n').trim();
                try {
                    const data = JSON.parse(dataStr);
                    if (data.tujuan === nomor && data.reff_id) {
                        reffIds.add(data.reff_id);
                    }
                } catch (e) {}
            }
        });

        // 2. Pair requests with their immediate next response if it matches
        for (let i = 0; i < blocks.length; i++) {
            const b = blocks[i];
            const fullText = b.header + '\n' + b.dataLines.join('\n');
            
            // Check if this block belongs to the target nomor or known reffIds
            const isMatch = fullText.includes(nomor) || Array.from(reffIds).some(rid => fullText.includes(rid));

            if (isMatch && b.header.includes('REQUEST')) {
                // Look for the next RESPONSE block (usually the next one)
                let responseBlock = null;
                for (let j = i + 1; j < i + 5 && j < blocks.length; j++) {
                    if (blocks[j].header.includes('RESPONSE') || blocks[j].header.includes('ERROR_RESPONSE')) {
                        responseBlock = blocks[j];
                        break;
                    }
                }
                
                pairs.push({
                    request: b,
                    response: responseBlock
                });
            }
        }

        return pairs;
    } catch (err) {
        return [];
    }
}

module.exports = {
    generateReffId,
    getTrackData
};
