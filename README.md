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

2. Copy `server/.env.example` to `server/.env` and set a unique `JWT_SECRET`.
3. Start MongoDB.
4. Start the API and Vite app:

   ```powershell
   npm run dev
   ```

The web app runs at `http://localhost:5173` and the API at
`http://localhost:5000/api`.
Versioned catalog search is available at `/api/v1/search`; the existing
`/api/equipment` routes remain as compatibility endpoints for the current UI.
Authentication is available at `/api/auth/register`, `/api/auth/login`,
`/api/auth/me`, and `/api/auth/logout`. Registration supports customer, owner,
and transporter accounts; administrator accounts cannot self-register.
Passwords are bcrypt-hashed and sessions use revocable JWT bearer tokens.
Register an account, then promote the first administrator from the project root
with `npm run admin:promote -- your-email@example.com`. New databases start
without sample accounts, bookings, or rental history. Create real marketplace
categories from the admin workspace before owners list equipment. To hide known
legacy starter inventory safely, preview with `npm run demo:clean` and apply
with `npm run demo:clean -- --apply`.

## Application foundation

The client is organized by responsibility under `client/src`: `pages`,
`components`, `layouts`, `services`, `hooks`, `utils`, `context`, and
`translations`. Axios configuration and response helpers live in
`services/api.js`; data reads made through `useLoad` use the shared TanStack
Query cache. Tailwind CSS utilities are available alongside the existing
stylesheet; Tailwind preflight is intentionally not enabled, to avoid changing
the established UI globally.

The Express API is organized under `server/src` into `routes`, `controllers`,
`services`, `models`, `middleware`, `validators`, `utils`, `sockets`, and
`config`. Route modules own endpoint paths and validation; controllers contain
request handling where separated, while domain services own reusable business
operations. Success and error responses use the documented JSON envelopes.
Socket.IO is attached to the API HTTP server and requires a valid JWT; no
browser socket client is enabled until a product workflow needs real-time
events.

Server variables are documented in `server/.env.example`. Optional frontend
configuration is in `client/.env.example`; leave `VITE_API_URL` unset to use
the Vite `/api` proxy in development.

Mock payments are the local default; no payment card data is stored or sent to
a provider in mock mode. State-changing booking, swap, and owner APIs persist
`Idempotency-Key` responses, and successful mock payment/refund/deposit changes
write append-only, retry-safe ledger entries.

Razorpay test/live checkout can be selected with server-side environment
credentials; the browser receives only the public key ID. See
[`server/README.md`](./server/README.md) for webhook setup and required events.

New installations show honest empty states until administrators configure the
catalog and real owners publish equipment. Application startup never deletes
existing records; the opt-in cleanup only deactivates exact historical fixture
records and skips those connected to active rentals, unexpired holds, active
deliveries, or open swaps. Completed transaction history remains intact.

The current system is a modular-monolith MVP, not a claim of production
enterprise scale: payments are mocked, and distributed queues, object storage,
external search, payouts/settlements, and deployment-specific capacity and
reconciliation testing still need production adapters. Rate limits use shared
MongoDB counters in production (`RATE_LIMIT_STORE=mongodb`) and process memory
for local development.

## Useful commands

- `npm run dev` — run API and web app in development mode.
- `npm run build` — create the production frontend build.
- `npm test --workspace server` — run backend unit and integration tests.
- `npm run admin:promote -- your-email@example.com` — promote a registered account to administrator.
- `npm run demo:seed` — preview five image-backed owner listings per active category and five rental bundles; run `npm run demo:seed -- --apply` to create them.
- `npm run demo:clean` — preview cleanup of known legacy demo inventory and packages.
- `npm run demo:clean -- --apply` — deactivate unreferenced known demo inventory and packages.
- `npm start` — start the API server.
