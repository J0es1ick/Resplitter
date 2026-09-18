const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const source = path.resolve(process.argv[2] || 'data/resplitter.sqlite');
const destination = path.resolve(process.argv[3] || 'data/backups/resplitter-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite');
if (source === destination) throw new Error('Backup must not overwrite the source');
mkdirSync(path.dirname(destination), { recursive: true });
const db = new DatabaseSync(source, { readOnly: true });
try {
  db.exec('PRAGMA busy_timeout=5000');
  db.prepare('VACUUM INTO ?').run(destination);
  console.log('Consistent SQLite backup: ' + destination);
} finally { db.close(); }
