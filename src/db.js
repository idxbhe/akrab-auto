const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists (Deployment-Ready)
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Active orders database
const adapter = new FileSync(path.join(dataDir, 'db.json'));
const db = low(adapter);

db.defaults({ 
    preorders: [],
    admin_chats: [],
    ghost_levels: {},
    system_config: {
        is_paused: false,
        pause_reason: "",
        last_pause_at: null
    }
})
  .write();

// Completed orders history database
const historyAdapter = new FileSync(path.join(dataDir, 'history.json'));
const historyDb = low(historyAdapter);

historyDb.defaults({ 
    history: []
})
  .write();

module.exports = {
    db,
    historyDb
};
