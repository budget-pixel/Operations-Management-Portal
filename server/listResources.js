/* =============================================================
   listResources.js
   Locations, Categories, and Assignees are all the same shape —
   a facility-staff-managed list of names that the Work Orders
   forms pick from. Rather than write three near-identical route
   sets, this registers the same GET/POST/DELETE trio against
   whichever table name it's given.

   Exposes: registerListResource(app, { path, singular, table })
   ============================================================= */

'use strict';

const db = require('./db');

function registerListResource(app, { path, singular, table }) {
  app.get(`/api/${path}`, (req, res) => {
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY name COLLATE NOCASE`).all();
    res.json({ [path]: rows });
  });

  app.post(`/api/${path}`, (req, res) => {
    const name = (req.body && req.body.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'Name is required.' });
    }

    try {
      const result = db.prepare(`INSERT INTO ${table} (name) VALUES (?)`).run(name);
      const created = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(result.lastInsertRowid);
      res.status(201).json({ [singular]: created });
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: `"${name}" already exists.` });
      }
      throw err;
    }
  });

  app.delete(`/api/${path}/:id`, (req, res) => {
    const result = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Not found.' });
    }
    res.status(204).end();
  });
}

module.exports = registerListResource;
