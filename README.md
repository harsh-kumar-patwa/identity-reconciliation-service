# Bitespeed Backend - Identity Reconciliation

A web service that links customer contacts across multiple purchases using email and phone number.

## Tech Stack

- Node.js + TypeScript
- Express 5
- Prisma 7
- SQLite

## Setup

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npx prisma generate
npm run build && npm start
```

For development: `npm run dev`

## API

### `POST /identify`

**Request:**
```json
{
  "email": "john@example.com",
  "phoneNumber": "9876543210"
}
```

At least one of `email` or `phoneNumber` is required.

**Response:**
```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["john@example.com", "john.doe@example.com"],
    "phoneNumbers": ["9876543210"],
    "secondaryContactIds": [2]
  }
}
```

### `GET /health`

Returns `{ "status": "ok" }`.

## How It Works

- If no match is found, a new primary contact is created.
- If the request has new info (e.g. known email but new phone), a secondary contact is created under the existing primary.
- If the request links two separate primaries, the older one stays primary and the newer one becomes its secondary.

## Project Structure

```
src/
├── index.ts                 # Entry point
├── app.ts                   # Express app
├── db.ts                    # Prisma client
├── routes/
│   └── contact.routes.ts    # /identify route
├── services/
│   └── contact.service.ts   # Reconciliation logic
└── types/
    └── contact.ts           # Interfaces
```

## Contact

Harsh Kumar - harshkumar3446@gmail.com
