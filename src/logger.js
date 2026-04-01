const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, '..', 'bot.log');
const apiLogFile = path.join(__dirname, '..', 'api.log');

/**
 * Mask sensitive data like api_key from logs
 */
function maskData(data) {
  if (!data || typeof data !== 'object') return data;
  try {
    // Deep clone to avoid modifying original object
    const masked = JSON.parse(JSON.stringify(data));
    const maskRecursively = (obj) => {
      for (const key in obj) {
        if (typeof obj[key] === 'string' && key.toLowerCase() === 'api_key') {
          obj[key] = '******** (HIDDEN)';
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          maskRecursively(obj[key]);
        }
      }
    };
    maskRecursively(masked);
    return masked;
  } catch (e) {
    return data;
  }
}

function log(level, message, data = null) {
  if (level === 'DEBUG' && process.env.DEBUG !== 'true') {
    return;
  }

  const timestamp = new Date().toISOString();
  let logStr = `[${timestamp}] [${level}] ${message}`;
  if (data) {
    const safeData = maskData(data);
    if (typeof safeData === 'object') {
        logStr += ` ${JSON.stringify(safeData)}`;
    } else {
        logStr += ` ${safeData}`;
    }
  }
  logStr += '\n';
  
  console.log(logStr.trim());
  // Asynchronous write (non-blocking)
  fs.appendFile(logFile, logStr, (err) => {
      if (err) console.error('Failed to write to log file', err);
  });
}

function logApi(action, data = null) {
  const timestamp = new Date().toISOString();
  let logStr = `[${timestamp}] [API] [${action}]`;
  if (data) {
    const safeData = maskData(data);
    if (typeof safeData === 'object') {
        logStr += ` ${JSON.stringify(safeData)}`;
    } else {
        logStr += ` ${safeData}`;
    }
  }
  logStr += '\n';

  // Asynchronous write (non-blocking)
  fs.appendFile(apiLogFile, logStr, (err) => {
      if (err) console.error('Failed to write to API log file', err);
  });
}

function formatDate(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  
  const pad = (n) => n.toString().padStart(2, '0');
  
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  
  return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
}

module.exports = {
  info: (msg, data) => log('INFO', msg, data),
  error: (msg, data) => log('ERROR', msg, data),
  warn: (msg, data) => log('WARN', msg, data),
  debug: (msg, data) => log('DEBUG', msg, data),
  logApi,
  formatDate
};
