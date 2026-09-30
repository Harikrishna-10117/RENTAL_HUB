# RentalHub API

Node.js/Express REST API backed by MongoDB. Existing endpoints are under `/api`;
the versioned catalog search endpoint is `/api/v1/search`. Responses use JSON envelopes:

- Success: `{ "success": true, "message": "...", "data": ... }`
- Error: `{ "success": false, "message": "...", "errorCode": "..." }`

Endpoint paths and request validation live in `src/routes` and
`src/validators`; request handlers that are shared or domain-specific live in
`src/controllers` and `src/services`. Models, middleware, utilities, socket
transport, and configuration are kept in their respective `src` directories.
Malformed JSON and oversized request bodies are normalized to the same error
envelope as application errors.

The HTTP server also hosts an authenticated Socket.IO transport. Clients must
provide a JWT in the Socket.IO `auth.token` handshake field; authenticated
sockets join their private `user:<id>` room. No application events are emitted
until a real-time feature is introduced.

## Local setup

1. Install Node.js 18+ and start a local MongoDB server.
2. From `server`, copy `.env.example` to `.env` and set `JWT_SECRET` to a random value of at least 32 characters. Set `MONGODB_URI` if MongoDB is not at the default `mongodb://127.0.0.1:27017/rentalhub`.
3. Run `npm install` and `npm run dev`.
4. Register an account in the client, then from the project root run `npm run admin:promote -- your-email@example.com`.
5. Sign in again and create real categories in the admin workspace. Owners can publish equipment after an administrator verifies their account.
6. Visit `http://localhost:5000/api/health`.

Set `VITE_API_URL` in the client environment only when the API is hosted
separately from the Vite development proxy; see `client/.env.example`.

There is no demo-data seed. New databases start without sample accounts,
bookings, or rental history, and application startup never deletes or rewrites
existing records. Bootstrap the first administrator by promoting an account
that has already registered through the client. The optional `npm run demo:clean`
command previews deactivation of exact historical fixture records; use
`npm run demo:clean -- --apply` to apply it. Records connected to active
rentals, unexpired holds, active deliveries, or open swaps are preserved.
Completed transaction history remains intact.

`EquipmentType` stores reusable product/catalog metadata, localized search
terms, and default pricing. `EquipmentAsset` is the physical owner-owned
inventory unit, with its own serial/QR identifiers, INR pricing, condition,
lifecycle state, and Indian location. `Equipment` remains a compatibility
projection for existing booking and owner endpoints; inventory mutations and
reservation locks are synchronized with the asset record.

Physical equipment details (specifications, dimensions, weight, operating,
operator, and transport requirements) are stored on the equipment/asset records
as structured fields. Booking, delivery, inspection, damage/refund, and review
records remain separate documents linked by IDs. Public catalog responses are
allow-listed and include only active, available listings; owner/admin inventory
endpoints include management metadata. Equipment verification can only be
changed by an administrator.

## API routes

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| POST | `/api/auth/register`, `/api/auth/login` | Public | Create customer, owner, or transporter account; sign in |
| GET | `/api/auth/me` | Authenticated | Current account |
| POST | `/api/auth/logout` | Authenticated | Revoke the current JWT session |
| GET | `/api/categories`, `/api/categories/:slug`, `/api/equipment`, `/api/equipment/:id` | Public | Browse active database categories and product counts, category catalog products, and rentable inventory; optional date availability via `startDate` and `endDate` |
| GET/POST | `/api/packages` | Public / verified owner | Browse or create packages |
| PATCH | `/api/packages/:id` | Owner | Update own package |
| POST/DELETE | `/api/bookings/holds`, `/api/bookings/holds/:id` | Customer | Hold selected equipment or a package for 10 minutes |
| POST | `/api/bookings` | Customer | Create from a valid `holdId`, or request directly with `equipmentId`, `startDate`, and `endDate`; prices are calculated by the API |
| POST | `/api/bookings/:id/hold` | Booking customer | Extend/confirm the pending booking's 10-minute date hold |
| POST | `/api/bookings/:id/pay` | Booking customer | Complete mock payment |
| GET | `/api/bookings/my`, `/api/bookings/mine`, `/api/bookings/:id` | Customer / booking parties | View bookings |
| PATCH | `/api/bookings/:id/status` | Customer / owner | Customer cancels; owner accepts, declines, or completes after inspection |
| POST | `/api/bookings/:id/cancel`, `/api/bookings/:id/return`, `/api/bookings/:id/inspection`, `/api/bookings/:id/reviews` | Booking parties | Cancel/request or record return, inspect and refund deposit, review completed rental |
| GET/POST/PUT/PATCH/DELETE | `/api/owner/equipment` and `/api/owner/equipment/:id` | Owner / admin | Owners manage their own equipment; admins can manage all equipment (admin creation requires `ownerId`) |
| GET/POST/PUT/PATCH/DELETE | `/api/admin/equipment` and `/api/admin/equipment/:id` | Admin | Administrative equipment management and verification |
| GET | `/api/owner/bookings` | Owner | View bookings for own inventory |
| GET/POST/PUT/PATCH | `/api/owner/equipment/:id`, `/api/equipment` and `/api/equipment/:id` | Owner | Compatibility routes used by the UI for own listings |
| PATCH | `/api/owner/bookings/:id/status` | Owner | Start, cancel, or complete an allowed booking transition |
| PATCH | `/api/owner/bookings/:id/delivery` | Owner | Advance delivery/pickup status |
| POST | `/api/owner/bookings/:id/inspection` | Owner | Inspect returned equipment and process mock deposit refund |
| GET/PATCH | `/api/admin/owners`, `/api/admin/owners/:id/verification` | Admin | Review and change owner verification |
| POST/GET/PATCH | `/api/swaps`, `/api/swaps/my`, `/api/swaps/mine`, `/api/swaps/:id/status`, `/api/swaps/:id/respond` | Customer / recipient owner | Booking-based UI swap requests or item-for-item, item-plus-cash, and cash-for-item swaps |
| GET | `/api/payments/my` | Customer | View mock payment history |
| GET/PATCH | `/api/users/me` | Authenticated | Read or update only the current account profile, address, preferred language, and (for owners) business details; owner responses include actual verification state |
| GET/POST/PATCH/DELETE | `/api/admin/categories`, `/api/admin/categories/:id` | Admin | Manage marketplace categories; DELETE deactivates without removing referenced records |
| GET/POST/PATCH/DELETE | `/api/admin/equipment-types`, `/api/admin/equipment-types/:id` | Admin | Manage catalog product types separately from owner-owned rentable equipment assets; products with active assets cannot be deactivated |
| GET/PATCH | `/api/notifications`, `/api/notifications/:id/read` | Authenticated | View and mark notifications read |
| GET | `/api/health` | Public | Health check |
| GET | `/api/v1/search`, `/api/search` | Public | Search physical inventory by task/product, localized aliases, category, city, rate, and condition |

Protected routes require `Authorization: Bearer <token>`. Reservation locks serialize competing holds on physical assets, while bookings and active holds are checked for overlapping date ranges using both legacy equipment references and asset references. Local MongoDB is required by default; there is no silent in-memory fallback. Explicit development fallback is available only with `USE_IN_MEMORY_DB=true` and a separately installed `mongodb-memory-server`.

Registration accepts customer, owner, and transporter roles.
Administrator accounts are never accepted by the public registration endpoint.
Passwords are bcrypt-hashed and excluded from normal model queries and API
responses; passwords are limited to 72 UTF-8 bytes to avoid bcrypt truncation.
Email addresses are normalized to lowercase, and non-empty Indian mobile
numbers are normalized and unique. JWTs carry a token version checked on every
protected HTTP and socket connection; logout increments that version to revoke
the session immediately.

Customer and owner profile details are stored on the authenticated user record
and are returned only by the self-scoped `/api/users/me` endpoint. Profile
updates cannot change roles or passwords; email and phone retain their unique
account constraints. Profile image and logo uploads are not supported because
the application has no configured upload or object-storage service.

State-changing booking, swap, and owner operations require an `Idempotency-Key`
header. The API persists request fingerprints and successful/error responses so
retries can replay the original result; a key cannot be reused with a different
request. External API clients must keep the same key when retrying one logical
operation. The web client supplies keys automatically.

Successful rental/deposit charges, cancellation refunds, swap adjustments, and
deposit dispositions post append-only, idempotent double-entry `LedgerEntry`
records in minor currency units. This is an accounting foundation, not a
settlement, payout, tax, or payment-provider reconciliation system. Payments
default to mock locally, with Razorpay checkout/webhooks/refunds available when
server credentials are configured. Set `RATE_LIMIT_STORE=mongodb` in production to use shared
rate-limit counters across API instances; development defaults to process
memory. Configure `TRUST_PROXY_HOPS` to the exact number of trusted reverse
proxies in front of Express; do not enable blanket forwarded-header trust.
Distributed job/cache, object-storage, external search-index, and
production observability adapters remain deployment work.
This modular-monolith MVP does not claim production scale or payment-provider
readiness.

## Razorpay checkout configuration

Local development defaults to mock payments. For Razorpay test mode, set
`PAYMENT_PROVIDER=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and
`RAZORPAY_WEBHOOK_SECRET` in the server environment. Never expose the secret or
webhook secret to the browser. The customer checkout uses the public key ID;
order creation, payment verification, and refund requests are server-side.

Configure the Razorpay webhook URL as
`https://<your-api-host>/api/payments/razorpay/webhook` and enable
`payment.captured`, `payment.failed`, `refund.processed`, and `refund.failed`.
The handler verifies the signature against the raw request body, stores event
IDs for replay protection, and retries incomplete event processing. Configure
test credentials and a reachable HTTPS endpoint before enabling this for users.
Production startup rejects mock payments and requires all Razorpay credentials.

Useful commands:

```sh
npm run dev
npm start
npm run admin:promote -- your-email@example.com
npm run demo:clean
npm test
```
