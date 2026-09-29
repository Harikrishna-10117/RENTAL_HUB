# RentalHub API

Node.js/Express REST API backed by MongoDB. Existing endpoints are under `/api`;
the versioned catalog search endpoint is `/api/v1/search`. Responses use JSON envelopes:

- Success: `{ "success": true, "message": "...", "data": ... }`
- Error: `{ "success": false, "message": "...", "errorCode": "..." }`

## Local setup

1. Install Node.js 18+ and start a local MongoDB server.
2. From `server`, copy `.env.example` to `.env` and set `JWT_SECRET` to a random value of at least 32 characters. Set `MONGODB_URI` if MongoDB is not at the default `mongodb://127.0.0.1:27017/rentalhub`.
3. Run `npm install`, `npm run seed`, then `npm run dev`.
4. Visit `http://localhost:5000/api/health`.

Seeded development accounts:

| Role | Email | Password |
| --- | --- | --- |
| Customer | `customer@rentalhub.com` | `Customer@123` |
| Owner | `owner@rentalhub.com` | `Owner@123` |
| Admin | `admin@rentalhub.com` | `Admin@123` |

The seed creates eight India-first categories, 40 catalog equipment types, 80
physical owner assets across Indian cities, and five task-oriented packages.
Re-running the seed is idempotent and does not delete non-demo users or booking
records. Legacy equipment records are migrated into physical asset records and
retain their existing booking IDs.

`EquipmentType` stores reusable product/catalog metadata, localized search
terms, and default pricing. `EquipmentAsset` is the physical owner-owned
inventory unit, with its own serial/QR identifiers, INR pricing, condition,
lifecycle state, and Indian location. `Equipment` remains a compatibility
projection for existing booking and owner endpoints; inventory mutations and
reservation locks are synchronized with the asset record.

## API routes

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| POST | `/api/auth/register`, `/api/auth/login` | Public | Create customer/owner account or sign in |
| GET | `/api/auth/me` | Authenticated | Current account |
| GET | `/api/categories`, `/api/equipment`, `/api/equipment/:id` | Public | Browse/filter catalog; optional date availability via `startDate` and `endDate` |
| GET/POST | `/api/packages` | Public / verified owner | Browse or create packages |
| PATCH | `/api/packages/:id` | Owner | Update own package |
| POST/DELETE | `/api/bookings/holds`, `/api/bookings/holds/:id` | Customer | Hold selected equipment or a package for 10 minutes |
| POST | `/api/bookings` | Customer | Create from a valid `holdId`, or request directly with `equipmentId`, `startDate`, and `endDate`; prices are calculated by the API |
| POST | `/api/bookings/:id/hold` | Booking customer | Extend/confirm the pending booking's 10-minute date hold |
| POST | `/api/bookings/:id/pay` | Booking customer | Complete mock payment |
| GET | `/api/bookings/my`, `/api/bookings/mine`, `/api/bookings/:id` | Customer / booking parties | View bookings |
| PATCH | `/api/bookings/:id/status` | Customer / owner | Customer cancels; owner accepts, declines, or completes after inspection |
| POST | `/api/bookings/:id/cancel`, `/api/bookings/:id/return`, `/api/bookings/:id/inspection`, `/api/bookings/:id/reviews` | Booking parties | Cancel/request or record return, inspect and refund deposit, review completed rental |
| GET/POST/PATCH/DELETE | `/api/owner/equipment` and `/api/owner/equipment/:id` | Verified owner | Manage own inventory |
| GET | `/api/owner/bookings` | Owner | View bookings for own inventory |
| GET/POST/PUT/PATCH | `/api/owner/equipment/:id`, `/api/equipment` and `/api/equipment/:id` | Owner | Compatibility routes used by the UI for own listings |
| PATCH | `/api/owner/bookings/:id/status` | Owner | Start, cancel, or complete an allowed booking transition |
| PATCH | `/api/owner/bookings/:id/delivery` | Owner | Advance delivery/pickup status |
| POST | `/api/owner/bookings/:id/inspection` | Owner | Inspect returned equipment and process mock deposit refund |
| GET/PATCH | `/api/admin/owners`, `/api/admin/owners/:id/verification` | Admin | Review and change owner verification |
| POST/GET/PATCH | `/api/swaps`, `/api/swaps/my`, `/api/swaps/mine`, `/api/swaps/:id/status`, `/api/swaps/:id/respond` | Customer / recipient owner | Booking-based UI swap requests or item-for-item, item-plus-cash, and cash-for-item swaps |
| GET | `/api/payments/my` | Customer | View mock payment history |
| PATCH | `/api/users/me` | Authenticated | Update own name, email, or phone |
| GET/POST/PATCH | `/api/admin/categories`, `/api/admin/categories/:id` | Admin | List, create, and activate/deactivate marketplace categories |
| GET/PATCH | `/api/notifications`, `/api/notifications/:id/read` | Authenticated | View and mark notifications read |
| GET | `/api/health` | Public | Health check |
| GET | `/api/v1/search`, `/api/search` | Public | Search physical inventory by task/product, localized aliases, category, city, rate, and condition |

Protected routes require `Authorization: Bearer <token>`. Reservation locks serialize competing holds on physical assets, while bookings and active holds are checked for overlapping date ranges using both legacy equipment references and asset references. Local MongoDB is required by default; there is no silent in-memory fallback. Explicit development fallback is available only with `USE_IN_MEMORY_DB=true` and a separately installed `mongodb-memory-server`.

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
npm run seed
npm test
```
