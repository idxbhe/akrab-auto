const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');

// Active orders database
const adapter = new FileSync(path.join(__dirname, '..', 'db.json'));
const db = low(adapter);

db.defaults({ 
    preorders: [],
    admin_chats: []
})
  .write();

// Completed orders history database
const historyAdapter = new FileSync(path.join(__dirname, '..', 'history.db'));
const historyDb = low(historyAdapter);

historyDb.defaults({ 
    history: []
})
  .write();

module.exports = {
    db,
    historyDb
};
