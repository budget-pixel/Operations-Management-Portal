# Budget Amendment Request

A responsive web app recreating the county Budget Amendment Request paper form as a digital form, built with React, Vite, TypeScript, and Tailwind CSS.

## Features

- Date, Department, Prepared By, and Title fields
- Amendment type selection (Fl. St. 129.06(2)(a)–(f))
- Transfer From / Transfer To account tables with add/remove rows and live totals
- Required-field validation with inline error messages
- Save Draft to browser local storage, with restore-on-load
- Print-friendly layout
- Mobile-friendly, responsive layout

## Getting Started

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

## Scripts

- `npm run dev` — start the development server
- `npm run build` — type-check and build for production
- `npm run preview` — preview the production build locally

## Project Structure

```
src/
  components/   # Reusable UI, form, and layout components
  hooks/        # Form state and local-draft hooks
  pages/        # Top-level page(s)
  types/        # Shared TypeScript types
  utils/        # Validation, currency, and storage helpers
```
