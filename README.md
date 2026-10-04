# Nouriva SIH Backend

A local full-stack version of the Nouriva prototype. The original UI is preserved and connected to a Node.js + Express + SQLite API.

## Requirements
- Node.js 18+ (20+ recommended)
- npm

## Run

```bash
npm install
npm start
```

Open: http://localhost:3000

## Backend API
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/state`
- `POST /api/food`
- `POST /api/safety`
- `POST /api/requests`
- `POST /api/tracking/advance`
- `POST /api/prediction`
- `GET /api/health`

## Database
SQLite database is created automatically as `nouriva.db` in the project root.

## Important demo note
Food safety is a prototype checklist only. It does not independently certify food safety; final decisions require responsible human verification and applicable requirements.
