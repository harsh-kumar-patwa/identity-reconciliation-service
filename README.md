# Bitespeed Backend - Identity Reconciliation

A web service that identifies and links customers across multiple purchases using their email and phone number.

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **Framework:** Express 5
- **ORM:** Prisma 7
- **Database:** SQLite (easily swappable to PostgreSQL/MySQL)

## Setup

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Run database migrations
npx prisma migrate dev

# Generate Prisma client
npx prisma generate

# Build and start
npm run build
npm start

# Or run in development mode
npm run dev
```

## API

### `POST /identify`

Identifies and consolidates contacts based on email and/or phone number.

**Request:**
```json
{
  "email": "mcfly@hillvalley.edu",
  "phoneNumber": "123456"
}
```

Both fields are optional, but at least one must be provided.

**Response:**
```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["lorraine@hillvalley.edu", "mcfly@hillvalley.edu"],
    "phoneNumbers": ["123456"],
    "secondaryContactIds": [23]
  }
}
```

### `GET /health`

Health check endpoint. Returns `{ "status": "ok" }`.

## How It Works

1. **New contact:** If no existing contact matches the provided email or phone, a new primary contact is created.

2. **Existing contact, new info:** If a match is found but the request includes new information (e.g., known email but new phone), a secondary contact is created and linked to the primary.

3. **Linking primaries:** If the request matches two separate primary contacts (e.g., email matches one group, phone matches another), the older primary stays primary and the newer one becomes secondary, merging both groups.

## Project Structure

```
src/
├── index.ts                 # Server entry point
├── app.ts                   # Express app setup
├── db.ts                    # Prisma client initialization
├── routes/
│   └── contact.routes.ts    # /identify route handler
├── services/
│   └── contact.service.ts   # Core identity reconciliation logic
└── types/
    └── contact.ts           # TypeScript interfaces
```
