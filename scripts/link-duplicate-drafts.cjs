const { DatabaseSync } = require('node:sqlite');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { assertSafeDuplicateDraft } = require('../dist/src/domain/receipt-identity');
const { sessionSchema } = require('../dist/src/domain/schema');
const [file, ...pairs] = process.argv.slice(2);
if (!file || !pairs.length || pairs.length % 2 || pairs.some((id) => !/^[A-Za-z0-9_-]{22}$/.test(id))) {
  throw new Error('Usage: node scripts/link-duplicate-drafts.cjs database.sqlite duplicateId canonicalId [duplicateId canonicalId ...]');
}
const databaseFile = path.resolve(file);
if (!existsSync(databaseFile)) throw new Error('Database does not exist');
const db = new DatabaseSync(databaseFile);
let transaction = false;
try {
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
  transaction = true;
  let linked = 0;
  for (let i = 0; i < pairs.length; i += 2) {
    const [duplicateId, canonicalId] = pairs.slice(i, i + 2);
    const prior = db.prepare('SELECT target_id FROM session_aliases WHERE alias_id=?').get(duplicateId);
    if (prior?.target_id === canonicalId) continue;
    if (prior || db.prepare('SELECT 1 FROM session_aliases WHERE alias_id=? OR target_id=?').get(canonicalId, duplicateId)) {
      throw new Error('UNSAFE_DUPLICATE_LINK');
    }
    const read = (id) => {
      const row = db.prepare('SELECT body FROM sessions WHERE id=? AND expires>?').get(id, Date.now());
      return row && sessionSchema.parse(JSON.parse(row.body));
    };
    assertSafeDuplicateDraft(read(duplicateId), read(canonicalId));
    db.prepare('INSERT INTO session_aliases VALUES (?,?)').run(duplicateId, canonicalId);
    db.prepare("UPDATE meta SET value=? WHERE value=? AND (key LIKE 'photo:%' OR key LIKE 'image:%')").run(canonicalId, duplicateId);
    linked++;
  }
  db.exec('COMMIT');
  transaction = false;
  console.log(`Linked ${linked} duplicate drafts. Original rows, participant selections and receipt contents were not changed.`);
} catch (error) {
  if (transaction) db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}
