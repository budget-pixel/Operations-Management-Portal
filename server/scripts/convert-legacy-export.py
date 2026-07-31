#!/usr/bin/env python3
"""
convert-legacy-export.py
Reads the old CMMS's "Work Order Inquiry" Excel export and converts it
into a plain JSON file (legacy-work-orders.json) the Node import script
(import-legacy-work-orders.js) can load — keeps the Excel-parsing
dependency (openpyxl) out of the Node/Express app entirely, since this
only ever needs to run once.

Usage: python3 convert-legacy-export.py <path-to-xlsx>
Writes: server/scripts/legacy-work-orders.json (git-ignored — contains
real facility/employee data from the export)
"""

import json
import sys
from datetime import datetime, date
from pathlib import Path

import openpyxl

STATUS_MAP = {
    'New': 'New',
    'In Progress': 'In Progress',
    'Work Complete': 'Completed',
    'Accounting Complete': 'Completed',
    'Canceled': 'Cancelled',
}


def clean(value):
    if value is None:
        return ''
    text = str(value).strip()
    return '' if text.lower() == 'none' else text


def title_case(text):
    """The legacy system stored locations/categories/assignees in ALL
    CAPS — str.title() reads far better for a dropdown, at the cost of
    mangling the rare all-caps abbreviation (e.g. "MH" -> "Mh") or digit
    boundary (e.g. "1250DVD" -> "1250Dvd"). Good enough without a
    hand-maintained abbreviation dictionary."""
    return text.title() if text else text


def to_iso(value):
    if isinstance(value, (datetime, date)):
        return datetime(value.year, value.month, value.day).isoformat() + 'Z'
    return None


def main():
    if len(sys.argv) != 2:
        print('Usage: python3 convert-legacy-export.py <path-to-xlsx>')
        sys.exit(1)

    source_path = Path(sys.argv[1])
    wb = openpyxl.load_workbook(source_path, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    header = rows[0]
    idx = {name: i for i, name in enumerate(header)}
    data_rows = rows[1:]

    def get(row, col):
        return clean(row[idx[col]])

    locations = set()
    categories = set()
    assignees = set()
    work_orders = []

    for row in data_rows:
        location = title_case(get(row, 'SUBJECT OF SERVICE NAME') or get(row, 'LOCATION NAME'))
        category = title_case(get(row, 'ACTIVITY CODE'))
        assigned_to = title_case(get(row, 'ASSIGNED NAME')) or None
        status_desc = get(row, 'STATUS DESCRIPTION')
        status = STATUS_MAP.get(status_desc, 'New')

        created_at = to_iso(row[idx['CREATED DATE']]) or to_iso(row[idx['REQUEST RECEIVED']])
        updated_at = (
            to_iso(row[idx['ACTUAL END DATE']])
            or to_iso(row[idx['SCHEDULED END DATE']])
            or created_at
        )

        wo_number = get(row, 'WO NUMBER')
        request_number = get(row, 'REQUEST NUMBER')
        servicing_dept = get(row, 'SERVICING DEPT')
        created_by = get(row, 'CREATED BY')
        description = title_case(get(row, 'WO DESCRIPTION')) or '(No description in legacy export)'

        if location:
            locations.add(location)
        if category:
            categories.add(category)
        if assigned_to:
            assignees.add(assigned_to)

        work_orders.append({
            'title': description[:100],
            'description': description,
            'location': location or 'Unknown (legacy import)',
            'category': category or 'Other',
            'priority': 'Medium',
            'status': status,
            'requesterName': created_by or 'Legacy Import',
            'requesterEmail': 'legacy-import@waltoncountyfl.gov',
            'assignedTo': assigned_to,
            'notes': (
                f'Imported from legacy CMMS. WO {wo_number}, Request {request_number}. '
                f'Servicing dept: {servicing_dept or "n/a"}. Created by: {created_by or "n/a"}.'
            ),
            'createdAt': created_at,
            'updatedAt': updated_at,
        })

    output = {
        'locations': sorted(locations),
        'categories': sorted(categories),
        'assignees': sorted(assignees),
        'workOrders': work_orders,
    }

    out_path = Path(__file__).parent / 'legacy-work-orders.json'
    out_path.write_text(json.dumps(output, indent=2))
    print(f'Wrote {len(work_orders)} work orders, {len(locations)} locations, '
          f'{len(categories)} categories, {len(assignees)} assignees to {out_path}')


if __name__ == '__main__':
    main()
