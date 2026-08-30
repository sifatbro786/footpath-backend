# Footpath backend — working context

Elmate Stationery, a Bangladesh stationery shop. Express 5 + MongoDB/Mongoose.
Frontend lives in a sibling repo, `footpath-frontend`, which has its own CLAUDE.md.

This file is read automatically at the start of a session. It exists so the next
session does not have to rediscover things that took a long time to find.

---

## Run it

```bash
npm install
npm run dev          # nodemon, port from .env (default 5000)
```

`.env` needs at minimum: `MONGO_URI`, `JWT_SECRET`, `JWT_EXPIRE`, `CLIENT_URL`,
SSLCommerz credentials, SMTP credentials, Cloudinary credentials.
There is no `.env.example` yet.

No test suite on the backend. `npm test` exits 1.

---

## Shape of the thing

```
server.js          33 route modules mounted; middleware order is load-bearing
controllers/       business logic (some files are 1000+ lines)
  admin/           admin-only controllers
models/            19 Mongoose models
routes/            public routes
  admin/           admin routes, all behind protect + admin
services/          pricingService, productCampaignService, emailService
middlewares/       auth, rate limiting, sanitize, upload, error
utils/             apiFeatures, asyncHandler, escapeRegex, makeSlug, districts
```

### Middleware order in server.js is deliberate

```
compression -> helmet(CORP cross-origin) -> /uploads static -> cors
  -> body parsers -> sanitizeRequest -> hpp -> globalApiLimiter -> routes
```

`sanitizeRequest` MUST come before `hpp`. Express 5 made `req.query` a
getter-only accessor, so both `express-mongo-sanitize`'s bundled middleware and
`hpp` throw when they try to assign to it. Our sanitizer redefines `req.query`
as a writable data property, which is what lets `hpp` work at all. See
`middlewares/sanitize.js` for the verified behaviour.

---

## Traps. Read before touching these areas.

### 1. Variants have no id

`variantSchema` is declared `{ _id: false }`. The ONLY thing identifying a
variant is its `options: [{name, value}]` array.

`orderController.updateProductStock` matches a cart/order line back to a variant
by comparing those option pairs. **A mismatch does not throw** — it logs a
warning and leaves stock untouched. So a bug here sells inventory that never
gets deducted, silently. The frontend mirrors this rule in
`src/lib/store/variants.js`; keep the two in agreement.

### 2. Price is decided server side, always

`createOrder` recomputes shipping, tax, discount, COD split and total through
`services/pricingService.js` and **ignores any price in the request body**.
`POST /api/checkout/calculate` exists so the UI can *display* the same numbers,
not so the client can decide them. Never start trusting a client price.

`variant.price` is computed and persisted by the `Product` pre-save hook,
campaigns included. Read it; do not recompute it.

### 3. COD is not a gateway bypass

`Order.paymentMethod` is `enum: ["COD", "SSLCommerz"]`. Both return a
`redirectUrl` from `createOrder`. COD charges delivery + COD fee online up front
(`codOnlinePaymentAmount`) and collects the item total on delivery
(`remainingAmount`). bKash and Nagad are not separate methods; SSLCommerz
aggregates them inside its hosted page.

### 4. A signed-in order comes from the server cart

`createOrder` builds a signed-in user's order from the **server Cart** and
ignores items in the body. Only guests may pass `guestItems`. And `Cart.user` is
required + unique, so there is no server-side guest cart. That is why
`POST /api/cart/merge` exists and why the frontend cart is dual-mode.

### 5. Guest orders are protected by a capability token

`Order.guestAccessToken` (48 hex chars, `select: false`). `GET /api/orders/:id`
returns a guest order only with a matching `?token=` / `x-order-token`, or to an
admin. Order numbers are sequential (`ORD` + `YYMMDD` + `NNNN`), so without this
the whole day's guest PII was walkable. Legacy guest orders predating the patch
have no token and are admin-only by design.

### 6. `updatedBy: "system"` silently vanishes

`statusHistory.updatedBy` is an ObjectId ref. Passing the string `"system"` does
not throw: Mongoose records a cast failure, and `save({ validateBeforeSave: false })`
(used throughout the payment flow) discards it, so the field saves as `undefined`.
Omit it for system entries instead. **Still present** in `adminNotes.addedBy` in
`paymentController` and `orderController` — worth a sweep.

### 7. Response envelopes are inconsistent

There is no single convention. Verify before consuming:

| Endpoint | Shape |
|---|---|
| `/api/products` | `{ success, products, total, totalPages, currentPage }` |
| `/api/products/featured` | `{ success, products }` |
| `/api/products/homepage-sections` | `{ success, sections: [{...,products}] }` |
| `/api/categories` | `{ success, count, total, data }` |
| `/api/hero-items` | `{ success, data }` |
| `/api/hero` | **bare object**, no envelope |
| `/api/admin/hero-content` | **bare array**, no envelope |
| `/api/reviews/product/:id` | `{ success, reviews, ratingStats, ... }` |
| A+ content admin | `{ success, aplusContents, pagination }` (`pages`, not `totalPages`) |

### 8. Campaign pricing is not applied everywhere

`getProducts` and `getProductBySlug` compute `finalPrice` /
`isUnderValidCampaign` / `campaignInfo`. **`getFeaturedProducts` and
`getHomepageSections` do not** — they derive discount from the base
`discountType` only. So a featured product inside a live campaign shows its
pre-campaign price on the homepage and the campaign price everywhere else. Fix
belongs in those two controllers, not in the frontend mapper.

### 9. Category filtering does not walk the tree

`getProducts` filters `{ $or: [{category: id}, {subCategory: id}] }` with no
descendant resolution. Browsing a parent category misses everything filed under
its children. The frontend has `collectSubtreeIds()` ready in
`src/lib/store/categoryTree.js`; widening needs this endpoint to accept a list.

### 10. Route ordering

Literal routes must be declared before `/:param` siblings, or Express matches the
literal as a param. Currently relied on by:
`/api/orders/track`, `/api/cart/merge`, `/api/reviews/featured`,
`/api/admin/products/low-stock`, `/api/checkout/shipping-rates`.

---

## Known open issues

- `save({ validateBeforeSave: false })` throughout the payment flow: validation
  is skipped exactly where money moves.
- Campaign cron (`server.js`) runs every minute in-process with no distributed
  lock. A multi-instance deploy will double-apply campaigns. Also logs on every
  tick.
- `console.log` everywhere, including full IPN bodies and order payloads (PII in
  logs). Needs a structured logger with redaction.
- Unused dependencies: `pg`, `body-parser`, `node-fetch`, `express-async-handler`.
- No tests, no `.env.example`, no API docs.
- `navbarItemSchema` pre-save builds `path` as `/category/<ObjectId>` rather than
  the slug, so the stored path is unusable as a link. The frontend works around
  it by building hrefs from the populated `category.slug`.
- CORS allows origin-less requests unconditionally (`!origin || origin === "null"`).
  Fine for Postman, should be gated on `NODE_ENV` in production.
- Password minimum is 6 characters with no complexity or breach check, and there
  is no account lockout after repeated failed logins (only an IP rate limit).

---

## Conventions

- ES modules throughout (`"type": "module"`).
- Controllers return `res.status(n).json({ success, ... })`.
- Rate limiters live in `middlewares/rateLimiter.js`: `authLimiter`, `otpLimiter`,
  `couponLimiter`, `trackingLimiter`, `globalApiLimiter`.
- Comments explain **why**, especially where a decision looks wrong at a glance.
  Several bugs in this codebase were caused by someone "fixing" something that
  was deliberate. Keep that habit.

---

## Status

Phases 0 through 9 are done: security patches, storefront foundation, homepage
wiring, catalogue, product detail, cart, checkout and payment, post-purchase and
account, admin gaps.

Remaining is **Phase 10 (hardening)** and **Phase 11 (launch)**. The full
breakdown, including per-phase task lists, lives in the roadmap artifact on
claude.ai and in `FOOTPATH_PROJECT_AUDIT.html` at the repo root.
