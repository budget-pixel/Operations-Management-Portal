/* =============================================================
   server.js
   REST API for the Work Orders module. Everything else in the
   portal (Budget/Grant/Rollforward) submits one-way to Google
   Apps Script — Work Orders needs to be read back and updated
   over time (status, assignment), which a plain Sheet append
   can't do well, so this module gets its own small backend
   instead.

   Run with: npm install && npm start   (from the server/ folder)
   Listens on PORT (default 4000). The frontend (js/workOrderApi.js)
   expects this at http://localhost:4000/api by default in local dev.
   ============================================================= */

'use strict';

const express = require('express');
const cors = require('cors');
const db = require('./db');
const registerListResource = require('./listResources');

const PORT = process.env.PORT || 4000;

// Fixed for v1 — only Locations, Categories, and Assignees are
// admin-managed (see server/listResources.js); Status and Priority
// stay a small fixed set defined here.
const STATUSES = ['New', 'Assigned', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

const app = express();
app.use(cors());
app.use(express.json());

registerListResource(app, { path: 'locations', singular: 'location', table: 'locations' });
registerListResource(app, { path: 'categories', singular: 'category', table: 'categories' });
registerListResource(app, { path: 'assignees', singular: 'assignee', table: 'assignees' });

function nowIso() {
  return new Date().toISOString();
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function allNames(table) {
  return db.prepare(`SELECT name FROM ${table} ORDER BY name COLLATE NOCASE`).all().map((row) => row.name);
}

// ---------------------------------------------------------------
// GET /api/work-orders — list, newest first. Each of ?status=,
// ?location=, ?category=, ?priority= filters to an exact match;
// omit one (or pass "All") to not filter on it. Multiple filters
// combine with AND.
// ---------------------------------------------------------------
app.get('/api/work-orders', (req, res) => {
  const filters = ['status', 'location', 'category', 'priority']
    .filter((field) => req.query[field] && req.query[field] !== 'All');

  const where = filters.map((field) => `${field} = ?`).join(' AND ');
  const values = filters.map((field) => req.query[field]);

  const rows = db
    .prepare(`SELECT * FROM work_orders${where ? ` WHERE ${where}` : ''} ORDER BY id DESC`)
    .all(...values);

  res.json({ workOrders: rows });
});

// ---------------------------------------------------------------
// GET /api/work-orders/:id
// ---------------------------------------------------------------
app.get('/api/work-orders/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  if (!row) {
    return res.status(404).json({ error: 'Work order not found.' });
  }
  res.json({ workOrder: row });
});

// ---------------------------------------------------------------
// POST /api/work-orders — create a new request. Always starts in
// status "New" — callers can't set status on create.
// ---------------------------------------------------------------
app.post('/api/work-orders', (req, res) => {
  const body = req.body || {};
  const required = ['title', 'description', 'location', 'category', 'priority', 'requesterName', 'requesterEmail'];
  const missing = required.filter((field) => !isNonEmptyString(body[field]));

  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required field(s): ${missing.join(', ')}.` });
  }

  const categories = allNames('categories');
  const locations = allNames('locations');

  if (!categories.includes(body.category)) {
    return res.status(400).json({ error: `Category must be one of: ${categories.join(', ')}.` });
  }
  if (!locations.includes(body.location)) {
    return res.status(400).json({ error: `Location must be one of the configured locations: ${locations.join(', ') || '(none configured yet)'}.` });
  }
  if (!PRIORITIES.includes(body.priority)) {
    return res.status(400).json({ error: `Priority must be one of: ${PRIORITIES.join(', ')}.` });
  }

  const timestamp = nowIso();
  const result = db
    .prepare(`
      INSERT INTO work_orders
        (title, description, location, category, priority, status, requester_name, requester_email, assigned_to, notes, created_at, updated_at)
      VALUES
        (@title, @description, @location, @category, @priority, 'New', @requesterName, @requesterEmail, NULL, NULL, @createdAt, @updatedAt)
    `)
    .run({
      title: body.title.trim(),
      description: body.description.trim(),
      location: body.location.trim(),
      category: body.category,
      priority: body.priority,
      requesterName: body.requesterName.trim(),
      requesterEmail: body.requesterEmail.trim(),
      createdAt: timestamp,
      updatedAt: timestamp,
    });

  const created = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ workOrder: created });
});

// ---------------------------------------------------------------
// PATCH /api/work-orders/:id — update status, assignment, and/or
// notes on an existing work order. No auth yet (v1) — anyone can
// update any work order, matching the rest of the portal today.
// ---------------------------------------------------------------
app.patch('/api/work-orders/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Work order not found.' });
  }

  const body = req.body || {};
  if (body.status !== undefined && !STATUSES.includes(body.status)) {
    return res.status(400).json({ error: `Status must be one of: ${STATUSES.join(', ')}.` });
  }
  if (body.assignedTo !== undefined && body.assignedTo !== null) {
    const assignees = allNames('assignees');
    if (!assignees.includes(body.assignedTo)) {
      return res.status(400).json({ error: `Assignee must be one of: ${assignees.join(', ') || '(none configured yet)'}.` });
    }
  }

  const next = {
    status: body.status !== undefined ? body.status : existing.status,
    assigned_to: body.assignedTo !== undefined ? body.assignedTo : existing.assigned_to,
    notes: body.notes !== undefined ? body.notes : existing.notes,
    updated_at: nowIso(),
  };

  db.prepare('UPDATE work_orders SET status = @status, assigned_to = @assigned_to, notes = @notes, updated_at = @updated_at WHERE id = @id')
    .run({ ...next, id: req.params.id });

  const updated = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  res.json({ workOrder: updated });
});

// ---------------------------------------------------------------
// GET /api/work-orders-meta — every option list the forms need in
// one call: fixed statuses/priorities, plus the admin-managed
// categories/locations/assignees.
// ---------------------------------------------------------------
app.get('/api/work-orders-meta', (req, res) => {
  res.json({
    statuses: STATUSES,
    priorities: PRIORITIES,
    categories: allNames('categories'),
    locations: allNames('locations'),
    assignees: allNames('assignees'),
  });
});

app.listen(PORT, () => {
  console.log(`Work Orders API listening on http://localhost:${PORT}`);
});
