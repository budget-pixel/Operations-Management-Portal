/* =============================================================
   import-legacy-work-orders.js
   One-time migration: loads legacy-work-orders.json (produced by
   convert-legacy-export.py from the old CMMS's Excel export) and
   inserts its distinct locations/categories/assignees plus all
   historical work orders into the live database.

   Idempotent — safe to re-run: list entries use INSERT OR IGNORE
   (unique on name), and work orders are only imported if the
   legacy WO # in their notes isn't already present.

   Run from server/: node scripts/import-legacy-work-orders.js
   Requires scripts/legacy-work-orders.json to exist (run the
   Python conversion script first).
   ============================================================= */

'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');

const DATA_PATH = path.join(__dirname, 'legacy-work-orders.json');

if (!fs.existsSync(DATA_PATH)) {
  console.error(`Missing ${DATA_PATH} — run convert-legacy-export.py first.`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

function seedList(table, names) {
  const insert = db.prepare(`INSERT OR IGNORE INTO ${table} (name) VALUES (?)`);
  const seed = db.transaction((values) => {
    values.forEach((name) => insert.run(name));
  });
  seed(names);
  console.log(`${table}: ${names.length} candidate names processed.`);
}

// Categories previously held a 7-item generic placeholder set
// (Electrical, Plumbing, ...) invented before real data existed. The
// legacy export's 41 activity codes are the real thing and are more
// granular (e.g. separate MOWING/IRRIGATION/PEST CONTROL), so this
// replaces the placeholder set rather than merging alongside it —
// merging would leave near-duplicates like "Electrical" and
// "ELECTRICAL" as separate dropdown entries.
db.exec('DELETE FROM categories');

seedList('locations', data.locations);
seedList('categories', data.categories);
seedList('assignees', data.assignees);

const alreadyImported = db
  .prepare("SELECT COUNT(*) AS count FROM work_orders WHERE notes LIKE 'Imported from legacy CMMS.%'")
  .get().count;

if (alreadyImported > 0) {
  console.log(`${alreadyImported} legacy work orders already present — skipping work order import (delete them first to re-import).`);
} else {
  const insertWorkOrder = db.prepare(`
    INSERT INTO work_orders
      (title, description, location, category, priority, status, requester_name, requester_email, assigned_to, notes, created_at, updated_at)
    VALUES
      (@title, @description, @location, @category, @priority, @status, @requesterName, @requesterEmail, @assignedTo, @notes, @createdAt, @updatedAt)
  `);

  const importAll = db.transaction((workOrders) => {
    workOrders.forEach((wo) => insertWorkOrder.run(wo));
  });

  importAll(data.workOrders);
  console.log(`Imported ${data.workOrders.length} historical work orders.`);
}
