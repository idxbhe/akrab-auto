const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, '..', 'bot.log');
const apiLogFile = path.join(__dirname, '..', 'api.log');

function log(level, message, data = null) {
  if (level === 'DEBUG' && process.env.DEBUG !== 'true') {
    return;
  }

  const timestamp = new Date().toISOString();
  let logStr = `[${timestamp}] [${level}] ${message}`;
  if (data) {
    if (typeof data === 'object') {
        logStr += ` ${JSON.stringify(data)}`;
    } else {
        logStr += ` ${data}`;
    }
  }
  logStr += '\n';
  
  console.log(logStr.trim());
  try {
      fs.appendFileSync(logFile, logStr);
  } catch(e) {
      console.error('Failed to write to log file', e);
  }
}

function logApi(action, data = null) {
  const timestamp = new Date().toISOString();
  let logStr = `[${timestamp}] [API] [${action}]`;
  if (data) {
    if (typeof data === 'object') {
        logStr += ` ${JSON.stringify(data)}`;
    } else {
        logStr += ` ${data}`;
    }
  }
  logStr += '\n';

  try {
      fs.appendFileSync(apiLogFile, logStr);
  } catch(e) {
      console.error('Failed to write to API log file', e);
  }
}

module.exports = {
  info: (msg, data) => log('INFO', msg, data),
  error: (msg, data) => log('ERROR', msg, data),
  warn: (msg, data) => log('WARN', msg, data),
  debug: (msg, data) => log('DEBUG', msg, data),
  logApi
};
