# RentalHub

RentalHub is a full-stack equipment-rental marketplace built with React, Vite,
Express, and MongoDB. It includes role-based customer, owner, and admin
experiences, date-aware booking and temporary reservation holds, mock payments,
equipment swaps, delivery tracking, and return/deposit workflows.
The catalog separates reusable equipment types from owner-listed physical
assets, supports English/Hindi/Tamil search, and displays prices in Indian rupees.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- MongoDB 6 or newer, running locally or available through a MongoDB connection

## Run locally

1. Install dependencies from the project root:

   ```powershell
   npm install
   ```

2. Copy `.env.example` to `server/.env` and set a unique `JWT_SECRET`.
3. Start MongoDB.
4. Seed the development database:

   ```powershell
   npm run seed
   ```

5. Start the API and Vite app:

   ```powershell
   npm run dev
   ```

The web app runs at `http://localhost:5173` and the API at
`http://localhost:5000/api`.
Versioned catalog search is available at `/api/v1/search`; the existing
`/api/equipment` routes remain as compatibility endpoints for the current UI.

## Development demo accounts

These accounts are for local development only. Change or remove them before
deploying:

| Role | Email | Password |
| --- | --- | --- |
| Customer | `customer@rentalhub.com` | `Customer@123` |
| Owner | `owner@rentalhub.com` | `Owner@123` |
| Admin | `admin@rentalhub.com` | `Admin@123` |

Mock payments are the local default; no payment card data is stored or sent to
a provider in mock mode. State-changing booking, swap, and owner APIs persist
`Idempotency-Key` responses, and successful mock payment/refund/deposit changes
write append-only, retry-safe ledger entries.

Razorpay test/live checkout can be selected with server-side environment
credentials; the browser receives only the public key ID. See
[`server/README.md`](./server/README.md) for webhook setup and required events.

The seed provides eight India-first categories, 40 catalog equipment types,
80 physical assets across Indian cities, and five task-oriented rental
packages. Re-running it is idempotent and preserves non-demo user accounts.
It also migrates legacy inventory records into the asset model without
deleting their booking IDs.

The current system is a modular-monolith MVP, not a claim of production
enterprise scale: payments are mocked, and distributed queues, object storage,
external search, payouts/settlements, and deployment-specific capacity and
reconciliation testing still need production adapters. Rate limits use shared
MongoDB counters in production (`RATE_LIMIT_STORE=mongodb`) and process memory
for local development.

## Useful commands

- `npm run dev` — run API and web app in development mode.
- `npm run build` — create the production frontend build.
- `npm run seed` — load development demo records into MongoDB.
- `npm start` — start the API server.
