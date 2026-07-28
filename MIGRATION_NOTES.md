# Migration Notes — Phase 0 + Phase 1

Original codebase → `footpath-backend`. Structure/naming only in this pass — no logic
changed except splitting `pageMeta.js` (route+logic mixed → controller+route) so it fits
the folder convention. All original behavior (including existing bugs) preserved.

## Naming convention applied

- Models: `PascalCase.js` (e.g. `Product.js`)
- Controllers: `camelCaseController.js`
- Routes: `camelCaseRoutes.js`
- Services: `camelCaseService.js`
- Everything else (middlewares, utils, config): `camelCase.js`
- Admin-only controllers/routes moved into `controllers/admin/` and `routes/admin/`

## Files deleted (dead code — verified unused, not silently guessed)

| File               | Why                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth.js`          | Imports `../models/user.model.js` (doesn't exist), never `require`/`import`-ed anywhere. Real auth logic lives in `middlewares/authMiddleware.js`.                                   |
| `mailer.js`        | Uses CommonJS `require()` in an ESM project — would crash if loaded. Never imported anywhere. Real mailer logic lives in `services/emailService.js`.                                 |
| `cron.js`          | Duplicate of the cron job already inline in `server.js` (lines 119–147 of the original). Never imported anywhere.                                                                    |
| `coupon_routes.js` | Imports from a non-existent `"../../controllers"` barrel file (would crash on load). Never mounted in `server.js`. Leftover from an earlier, abandoned admin-route refactor attempt. |

## Files split

- **`pageMeta.js`** (route file with all logic inline, no controller) → split into
  `controllers/pageMetaController.js` + `routes/pageMetaRoutes.js`.
    - ⚠️ Preserved as-is: the original defined `router.post("/")` **twice** — the second is
      dead/unreachable code (kept as `createPageMetaDuplicate` for transparency, wire it out in Phase 3).
    - ⚠️ Preserved as-is: none of the mutating routes (create/update/delete/toggle/bulk) have
      `protect`/`adminOnly` applied even though both are imported. **No-auth admin endpoints — fix in Phase 3.**

## ✅ FIXED (this pass)

### 1. Hero route collision + missing auth

- **Before:** `heroRoutes.js` (`Hero`/`HeroItem` model) and `heroContentRoutes.js` (`HeroContent`
  model) were both mounted on `/api/hero`. Since `heroContentRoutes` was mounted first,
  its `GET /` permanently shadowed `heroRoutes`'s `GET /` — the HeroItem list was
  unreachable. `heroRoutes`'s `POST /`, `PUT /:id`, `DELETE /:id`, and bulk `PUT /` had
  **zero auth middleware** (anyone could create/edit/delete hero items).
- **Fix:**
    - `heroRoutes.js` now mounts on its own path: **`/api/hero-items`** (was `/api/hero`).
      `heroContentRoutes.js` keeps `/api/hero`. **Frontend integration note:** any client
      call hitting `/api/hero` for banner/slider items (not hero _content_) needs to move
      to `/api/hero-items`.
    - Added `protect, admin` middleware to all four mutating routes in `heroRoutes.js`.
    - No merge of the two models was done — they're kept as genuinely separate features
      (`HeroContent` = single active banner content; `Hero`/`HeroItem` = list of slider items).
      Revisit whether both are actually needed for Footpath, or consolidate into one model,
      during the Cart/Order/Product-adjacent module audits.

### 2. Hardcoded SMTP credentials in `services/emailService.js`

- **Before:** a real Gmail address + app password were hardcoded directly in source
  (`SMTP_CONFIG`), and partially logged to console on startup.
- **Fix:** now reads `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM`
  from `.env` (all already present in `.env.example`). Logs a warning instead of the
  credentials if they're missing. Sender name/branding ("Innoel Technology" in the email
  HTML templates) was **not** changed — that's cosmetic rebranding, tracked separately below.

## Known duplicate / conflicting files kept (renamed, flagged — not merged)

| File                                             | Issue                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `models/CouponLegacy.js` (was `coupon_model.js`) | Different schema than `models/Coupon.js` (`discountType`/`discountValue` vs `couponType`/`value`). Only referenced by `services/discountService.js`, which itself is **not imported anywhere** (dead service). Low risk today, but if `discountService.js` is ever wired up, decide which Coupon schema is canonical and delete the other. |

## Orphan modules (not wired into `server.js` — not deleted, just flagged)

These exist as complete route/controller pairs but aren't `app.use()`-mounted anywhere,
so they're currently unreachable. Kept in the new structure in case they're intentional
work-in-progress; mount them in `server.js` if/when needed.

- `routes/chatbotRoutes.js`
- `routes/lazychatRoutes.js` + `controllers/lazychatController.js`
- `routes/contactRoutes.js`
- `routes/faqRoutes.js`
- `routes/serviceContactRoutes.js`
- `routes/serviceRoutes.js`
- `routes/campaignRoutes.js` + `controllers/campaignController.js` (campaign CRUD exists but isn't mounted — only `productCampaignRoutes` is)
- `services/discountService.js` (see CouponLegacy note above)

## Case-sensitivity risk found & fixed

Original repo had both `PageMeta.js` (model) and `pageMeta.js` (route file) at the same
directory level — identical names except case. Safe on Linux, but collides on
case-insensitive filesystems (Windows/default macOS). Resolved naturally by the
model/controller/route split above.

## ✅ FIXED — Phase 4 (rebrand + one more critical bug found along the way)

### 3. 🔴 CRITICAL: `config/sslcommerz.js` ignored `.env` entirely

`STORE_ID`, `STORE_PASS`, and `IS_SANDBOX` were hardcoded to `""`, `""`, and `false` —
**not read from `.env` at all**, despite `SSLCOMMERZ_STORE_ID` / `SSLCOMMERZ_STORE_PASSWORD`
/ `SSLCOMMERZ_IS_SANDBOX` existing in the env file. Every payment init request was sending
an empty `store_id`/`store_passwd` to SSLCommerz — **payments could never have worked**,
regardless of what you put in `.env`. Fixed to actually read `process.env.SSLCOMMERZ_*`,
with a startup warning if they're missing.

### 4. CORS `allowedOrigins` hardcoded to old domains

`server.js` now builds the allow-list from `CLIENT_URL` + `FRONTEND_URL` (comma-separated)
in `.env`, plus sensible localhost/SSLCommerz defaults — no more hardcoded
`innoelbd.com`/`augmenticdigital.com` entries. Put Footpath's real domains in `.env`.

### 5. Hardcoded brand name/URLs in `services/emailService.js`

- "Innoel Technology" in email subjects/HTML → now `${SITE_NAME}`, read from `.env`
  (`SITE_NAME=Footpath` added to `.env.example`).
- Fallback URLs (`https://www.innoelbd.com`) in email button links → now fall back to
  `http://localhost:5173` instead of the old production domain.

## ✅ Phase 3 — Cart + Order module audit (COMPLETE)

### Shipping charge was multiplying by quantity ("per item shipping")

- **File:** `controllers/checkoutController.js` → `calculateCheckoutData`
- **Before:** `totalShippingPrice = rateDoc.baseCharge * totalQuantity`. Inherited from a
  previous (heavier-goods, e.g. fan) project where per-unit shipping made sense.
- **After:** shipping is now a flat charge = `rateDoc.baseCharge` (the admin-set value per
  `locationType` + `deliveryType`, e.g. 70/100/130/170), applied once per order regardless
  of quantity — correct for lightweight stationery. Free-shipping and reduced-shipping
  thresholds still work, just against the flat charge instead of a per-item value.
- `shippingBreakdown.perItemCharge` renamed to `shippingBreakdown.flatCharge` everywhere
  (controllers + `Order.js` schema) — no frontend exists yet for Footpath, so this was safe
  to rename cleanly rather than keep a legacy field name.
- Also removed a **second, dead, hardcoded** `calculateShippingPrice()` function that lived
  in `orderController.js` (different values — 50/70/130 — that didn't match the real
  ShippingRate collection at all, and was never called). Confusing leftover, deleted.

### 🔴 CRITICAL: `Order.js` schema `locationType` enum didn't match what controllers send

`shippingAddressSchema.locationType` only allowed `["inside_dhaka", "outside_dhaka"]`, but
both `checkoutController.js` and `orderController.js` validate and send
`"dhaka_inside"` / `"dhaka_sub"` / `"outside_dhaka"`. `"dhaka_inside"` ≠ `"inside_dhaka"` —
**every order with a Dhaka address would throw a Mongoose ValidationError on save()**, and
`"dhaka_sub"` wasn't a valid value at all. This was almost certainly breaking most real
orders. Fixed the enum and the related conditional-`required` checks on address fields to
use the correct strings.

### 🔴 CRITICAL: price-tampering — client controlled prices at multiple points

1. **`cartController.js` → `addItemToCart`**: trusted `finalPrice` / `basePrice` /
   `discountPercentage` straight from the request body (`finalPrice || product.price`). A
   client could add any product to cart at any price. **Fixed** — price is now always
   derived from the server-side Product/variant record; client price fields are ignored.
2. **`orderController.js` → `createOrder`**: trusted `shippingPrice`, `taxPrice`,
   `discountAmount` from the request body, and in the COD branch also trusted
   `codOnlinePaymentAmount` / `codCharge` / `remainingAmount` directly. A client could call
   `POST /api/orders` directly (skipping the checkout-preview call) with
   `shippingPrice: 0, discountAmount: 999999` etc. **Fixed** — extracted a new
   `services/pricingService.js` (coupon validation, shipping charge, COD split, tax) used by
   **both** `checkoutController.js`'s preview endpoint and `createOrder`, so nothing
   price-related is ever accepted from the client for a public order. `checkoutController.js`
   now imports its coupon/shipping helpers from this shared service instead of duplicating them.

### Order item variant data loss

`orderItemSchema.variant` only stored `{ name, value, sku }` — a single attribute. Any
variant with more than one attribute (e.g. Color + Size) silently lost every attribute past
the first when `convertVariantToOrderFormat` mapped `variant.options[0]`. Now stores the
full `options` array (matches the Cart item shape), so order records and any future
admin-dashboard variant reporting are accurate.

### Stock decrement bugs (`updateProductStock` in `orderController.js`)

1. Only matched variants by `sku`. Product variant `sku` is optional/sparse — if missing or
   mismatched, the function silently did nothing (stock never adjusted, no error surfaced).
   Now falls back to options-based matching, same principle as Cart.
2. Used a plain read → modify → `save()` pattern — a race condition under concurrent orders
   (same class of bug already fixed in the Product module). Now uses atomic
   `findOneAndUpdate` with `$inc` and a query-level stock guard, with a `console.warn` if a
   variant genuinely can't be matched (instead of failing silently).

### Cart stock validation

`addItemToCart` and `updateCartItem` didn't check requested quantity against real product/
variant stock at all. Both now return `400` if the requested quantity exceeds available stock.

### Cleanup

- Removed the dead `variantId` field from `Cart.js`'s variant subdocument — Product variants
  have `_id: false` (see `models/Product.js`), so it was always `undefined` and matching was
  always happening via the `options` array anyway. Also removed the corresponding dead
  matching branch in `cartController.js`.
- `routes/admin/adminOrderRoutes.js` had **`GET /:id` and `DELETE /:id` registered twice**
  (two separate `router.route("/:id")` chains) — every admin "view order" request would run
  `getOrderByIdAdmin` twice in sequence, throwing `ERR_HTTP_HEADERS_SENT` on the second call
  once a response had already been sent. Removed the duplicate registration.
- Removed a dead, unused `calculateShippingPrice()` in `orderController.js` (see shipping
  section above) and a dead, unwired `updateOrder` function is still present but not routed
  anywhere — low priority, flagged for a later cleanup pass.

### Worth knowing (not a bug, design note)

`getCart` re-syncs cart item prices with the live Product price and drops inactive/
out-of-stock items every time the cart is fetched — but `createOrder` reads the `Cart`
document directly, not through `getCart`, so if a product's price changes between the last
cart view and the moment "Place Order" is clicked (without revisiting the cart page in
between), the order will use the price captured at add-to-cart time. This is a common,
acceptable e-commerce pattern (price locked at cart-add time), not something fixed here —
just flagged so it's a deliberate choice rather than a surprise later.

### ✅ Phase 3 — Coupon + Auth module audit (COMPLETE)

### 🔴 CRITICAL: forgot-password flow was completely broken

`authController.js`'s `forgotPassword` calls `sendEmail({ template: "passwordReset", ... })`,
but `services/emailService.js` never defined a `passwordReset` template — only
`emailVerification`, `promotionOffer`, `abandonedCartReminder` existed.
`emailTemplates["passwordReset"]` was `undefined`, and calling it as a function threw
immediately (caught by the try/catch, so users just saw "Failed to send OTP"). **No one
could ever reset their password.** Added the missing template.

### 🔴 CRITICAL: coupon usage was never actually enforced or tracked

Three separate bugs, all inherited into the new `services/pricingService.js` from the
original `checkoutController.js` logic:

1. `Coupon.usedCount` has `select: false` in the schema — `Coupon.findOne(...)` (without
   `.select('+usedCount')`) always returned `undefined` for it, so the max-usage check
   (`usedCount >= maxUsage`) silently never triggered.
2. `couponType === "fixed"` was checked, but the schema's actual enum value is
   `"fixed_amount"` — fixed-amount coupons applied **zero discount** in checkout/order
   creation (only percentage and free-shipping coupons worked).
3. `incrementCouponUsage()` (already written in `couponController.js`) was never called
   anywhere — even coupons that did apply correctly never had their usage count go up, so
   `maxUsage` limits were unenforceable regardless of bug #1.

All three fixed: `applyCouponLogic` now selects `usedCount` explicitly and guards
`maxUsage > 0` (0 = unlimited, matching `couponController.js`'s own convention), checks
`"fixed_amount"`, and `createOrder` now calls `incrementCouponUsage` after a successful
SSLCommerz-session or COD order (best-effort, outside the DB transaction). Note: for the
SSLCommerz path this increments at order-creation time, not at confirmed-payment time —
acceptable for now, but if a customer abandons the payment page the usage still counts.
Moving it to the payment-confirmation webhook in `paymentController.js` would be more
precise if that matters for how the owner runs promotions.

### Account enumeration in forgot-password

Used to return `404 "No user found with this email"` when the account didn't exist, letting
anyone check which emails are registered. Now always returns the same generic response.

### No rate limiting anywhere

`express-rate-limit` was already a `package.json` dependency but never actually used —
login, registration, OTP verification/resend, and password reset had no brute-force
protection at all (OTPs are only 6 digits). Added `middlewares/rateLimiter.js`
(`authLimiter`: 20 req/15min for login/register, `otpLimiter`: 10 req/15min for
OTP/reset endpoints) and wired it into `routes/authRoutes.js`.

### Branding cleanup

Remaining "Innoel Technology" strings in `authController.js` email subjects → `SITE_NAME`.

### Quick-scanned, no critical issues found

`Category` module, `reviewController.js` (validation IS actually enforced — it calls
`validationResult(req)` inline in each controller function, not via separate middleware, so
this looked broken at a glance but isn't), `productCampaignController.js`/
`productCampaignService.js` structure.

### Minor, not fixed (low priority / needs a product decision)

- `MAX_FILE_SIZE` in `.env` isn't actually read anywhere — `uploadController.js` hardcodes
  5MB and `middlewares/upload.js` hardcodes 50MB independently. Pick one source of truth if
  this matters; currently harmless (both limits are reasonable), just inconsistent.
- The `Campaign`/`Promotion` "abandoned cart" discount system (`promotionController.js`,
  `campaignController.js`) doesn't appear to feed into `pricingService.js` / checkout
  totals at all — applying a campaign just marks it `"used"` in its own collection. If this
  is meant to actually discount the order, it needs to be wired into the pricing service;
  if it's just for email-marketing tracking, it's fine as-is. Worth clarifying before
  building the frontend around it.

## ✅ Phase 3 — Payment, Admin, Content controllers + shared utils (COMPLETE)

### 🔴 MOST CRITICAL BUG OF THE ENTIRE AUDIT: payment verification bypass

**File:** `controllers/paymentController.js` → `processSuccessRedirect`
This is the public, unauthenticated redirect endpoint SSLCommerz sends the customer's
browser to after payment. It used to do:

```js
if (val_id && status === "VALID") {
    /* verify properly */
} else {
    isVerified = true;
} // ⚠️ comment claimed "development mode" — NO env check existed
```

Anyone could send `GET /api/payment/process-success?orderId=<any pending order id>` with
**no `val_id` at all**, and the order would be marked `Paid`/`Confirmed`, stock decremented,
for free — in production, no login required. Fixed: missing/invalid `val_id` now always
means "not verified" (order goes to `Cancelled`/`Failed`), never trusted by default. The
real IPN webhook (`handleIPN`) already did server-to-server verification correctly — this
redirect handler is a convenience/UX path only now, not a source of truth for payment status.

### 🔴 CRITICAL: hero-content admin routes had zero auth (missed in an earlier pass)

`routes/heroContentRoutes.js` had a comment literally warning `🚨 No Auth Middleware is
called here!` — and it was true. `POST/PUT/DELETE /api/hero/admin/hero...` let anyone
create/edit/delete hero banner content with no login at all. This was flagged in the very
first Phase 0 audit alongside the route-collision fix, but only the collision was actually
fixed at the time — the missing auth was overlooked until this pass. Added `protect, admin`
to all three admin routes.

### 🔴 CRITICAL: fresh database = checkout can never work

Nothing in the codebase could ever create a `ShippingRate` document — only
`updateShippingRate(id)` existed, which needs an `_id` that never gets created in the first
place. On a brand-new database (i.e. Footpath, starting fresh), `getAllShippingRates`
returns `[]`, there's nothing for the admin to edit, and every checkout attempt fails with
"Shipping rate configuration not found." Fixed:

- Added `POST /api/admin/shipping/rates` (`createShippingRate`) so the admin panel can
  add new zone/delivery-type rates going forward.
- Added `scripts/seedShippingRates.js` (run once: `npm run seed:shipping`) that creates the
  4 real reachable combinations pre-filled with your 70/100/130/170 numbers — adjust anytime
  from the admin panel afterward, no need to re-run.

### `analyticsController.js`: crash + fake numbers

- `new mongoose.Types.ObjectId(category)` was used but `mongoose` was never imported —
  crashed with `ReferenceError` whenever a category filter was applied to the sales report.
- The dashboard computed `profit`/`profitMargin` by summing `$itemsPrice` — a field that
  doesn't exist anywhere in the `Order` schema. `totalCost` was always `0`, so `profit` was
  always shown as `100%` margin — a fake number on your own dashboard. Removed rather than
  fake it; to show real profit, add a `costPrice` field to `Product` and sum it per order
  item in this aggregation.

### NoSQL injection + ReDoS in the shared query-filtering utility

`utils/apiFeatures.js` (used by `categoryController.js` and others) had two issues:

1. `search()` built a `RegExp` directly from raw user input — a crafted pattern with
   catastrophic backtracking could hang the query (ReDoS), on Node's event loop and/or on
   MongoDB itself depending on how it's evaluated.
2. `filter()` only prefixed bare `gte/gt/lte/lt` words with `$` — an already-prefixed
   operator key sent directly in a query string (e.g. `?price[$where]=...`) passed straight
   through into the Mongo filter untouched. Now sanitized against an explicit allow-list
   (`$gte $gt $lte $lt $in $ne`); anything else is stripped.

The same raw-regex-from-user-input pattern was copy-pasted into several other
controllers — patched all of them to use the new `utils/escapeRegex.js` helper:
`productController.js` (public product search — highest risk, unauthenticated,
high-traffic), `orderController.js`, `controllers/admin/adminCartController.js`,
`offerPopupController.js`, `aplusContentController.js`.

### `adminCartController.js`: broken cart search

`getAllCarts`'s search filter queried `"user.name"`, `"user.email"`, `"items.product.name"`
directly against the `Cart` collection — but `user` and `items.product` are plain ObjectId
references, not embedded documents, so those paths don't exist on a Cart document at all.
The search box in the admin cart list silently returned zero results for every search term.
Fixed: resolves matching `User`/`Product` ids first, then filters carts by those ids.

### Cleanup

- `navbarController.js`'s default logo pointed at a random, unrelated Times-of-India CDN
  image URL (copy-pasted placeholder, appeared twice). Replaced with an empty string + a
  note to set the real logo from the admin panel.
- Misleading comment in `adminController.js` claiming a route had "no authentication
  required" — it does (protect+admin applied globally in `adminRoutes.js`), just an
  inaccurate leftover comment.

### Quick-scanned, no other critical issues found

`navbarController.js`, `offerPopupController.js`, `heroContentController.js` (business
logic — separately from the routing-auth bug above), `districts.js` (static data file, not
executable logic), `paymentController.js`'s `processFailRedirect`/`processCancelRedirect`/
`handleIPN` (IPN path was already doing correct server-to-server verification).

### Not fixed / worth knowing

- `aplusContentController.js` has ~259 lines of dead, commented-out old code at the top of
  the file before the real (working) implementation starts. Harmless but confusing to read;
  safe to delete whenever convenient.
- `controllers/uploadController.js` exports a multer instance as its default export
  (imported by `aplusContentRoutes.js`) — works fine, just an unusual place for it to live;
  `middlewares/upload.js` is the more conventional location and already has its own
  multer setup. Not unified in this pass.

## ✅ Phase 5 — Full admin-route restructuring (COMPLETE)

You were right — the first pass only moved 5 pre-existing admin files
(`adminController`, `adminShippingController`, `adminCartController`,
`analyticsController`, `adminOrderRoutes`/`Controller`) and left every other admin route
mixed into its "public" file, distinguished only by `protect`/`admin` middleware on
individual routes. Went through **every** route file and pulled out anything admin-only.

### New admin route/controller files

| Public file (unchanged, now user/guest-only)                   | New admin file                                                                       | Mounted at                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------ |
| `routes/productRoutes.js`                                      | `routes/admin/productAdminRoutes.js`                                                 | `/api/admin/products`          |
| `routes/couponRoutes.js`                                       | `routes/admin/couponAdminRoutes.js`                                                  | `/api/admin/coupons`           |
| `routes/heroRoutes.js` (+ new `controllers/heroController.js`) | `routes/admin/heroAdminRoutes.js` (+ new `controllers/admin/heroAdminController.js`) | `/api/admin/hero-items`        |
| `routes/heroContentRoutes.js`                                  | `routes/admin/heroContentAdminRoutes.js`                                             | `/api/admin/hero-content`      |
| `routes/offerPopupRoutes.js`                                   | `routes/admin/offerPopupAdminRoutes.js`                                              | `/api/admin/offers`            |
| `routes/productCampaignRoutes.js`                              | `routes/admin/productCampaignAdminRoutes.js`                                         | `/api/admin/product-campaigns` |
| `routes/promotionRoutes.js`                                    | `routes/admin/promotionAdminRoutes.js`                                               | `/api/admin/promotions`        |
| `routes/reviewRoutes.js`                                       | `routes/admin/reviewAdminRoutes.js`                                                  | `/api/admin/reviews`           |
| `routes/categoryRoutes.js`                                     | `routes/admin/categoryAdminRoutes.js`                                                | `/api/admin/categories`        |
| `routes/navbarRoutes.js`                                       | `routes/admin/navbarAdminRoutes.js`                                                  | `/api/admin/navbar`            |
| `routes/aplusContentRoutes.js`                                 | `routes/admin/aplusContentAdminRoutes.js`                                            | `/api/admin/aplus-content`     |
| `routes/pageMetaRoutes.js`                                     | `routes/admin/pageMetaAdminRoutes.js`                                                | `/api/admin/page-meta`         |
| _(was `routes/uploadRoutes.js`, now removed — fully admin)_    | `routes/admin/uploadAdminRoutes.js`                                                  | `/api/admin/upload`            |

Every admin router now uses `router.use(protect, admin)` (or `adminOnly`) once at the top of
the file instead of repeating it per-route — consistent with the original 5 admin files.

**⚠️ URLs changed for the routes that moved.** Since there's no live frontend for Footpath
yet, admin-facing endpoints were also cleaned up to drop redundant `/admin/...` segments now
that the mount path itself says `/admin` (e.g. `POST /api/aplus-content/admin/dashboard`
→ `GET /api/admin/aplus-content/dashboard`). Full before/after list: see the table above
for base paths; sub-paths mostly kept their same shape minus the `/admin` prefix.

### 🔴 THREE MORE completely unauthenticated admin endpoints found during the split

Going file-by-file surfaced bugs the earlier scans missed:

1. **`categoryRoutes.js`** — `createCategory`, `updateCategory`, `deleteCategory`,
   `deleteCategoryImage` had **zero auth** despite the controller doc-comments saying
   `@access Private/Admin`. Anyone could create/edit/delete product categories.
2. **`navbarRoutes.js`** — `PUT /config` (`updateNavbarConfig`) had **zero auth**. Anyone
   could rewrite the site's entire navigation menu.
3. **`uploadRoutes.js`** — all three upload endpoints (`/single`, `/multiple`, `/offer`)
   had **zero auth**. Anyone could upload arbitrary files to the server (storage abuse /
   spam risk). Moved fully under `/api/admin/upload`.
4. **`productRoutes.js`** — `GET /admin/dashboard` (the _non-optimized_ variant) had no auth
   at all, while `/admin/dashboard/optimized` right next to it correctly required admin.
   Inconsistency — now both require admin via the router-level `protect, admin`.

All four fixed the same way as the earlier hero-content bug: added `protect`/`admin` where
it was missing entirely, not just reorganized.

### Cleanup while splitting

- `pageMetaController.js`'s dead, unreachable `createPageMetaDuplicate` handler (flagged
  but kept for transparency in the Phase 1 pass) is now deleted outright — nothing routes
  to it anymore, no reason to keep it around.
- Verified with a real import test (not just file-existence checking) that every named
  export referenced by every new route file actually exists in its controller — all 37
  currently-mounted route files import cleanly. The only failures were the 5 already-known
  orphan routes (`chatbotRoutes`, `contactRoutes`, `faqRoutes`, `serviceRoutes`,
  `serviceContactRoutes`), which use CommonJS `require()` in this ESM project and would
  crash if anyone ever wired them into `server.js` — same class of bug as the earlier
  `mailer.js`/`auth.js` finds. Still not mounted, still not fixed (out of scope until wired up).

Full Order status-transition lifecycle edge cases (Cancelled/Refunded), `Campaign`/
`ProductCampaign` cron-driven pricing math itself (structure looked fine, formulas not
independently re-derived), orphan routes (`chatbotRoutes`, `lazychatRoutes`,
`contactRoutes`, `faqRoutes`, `serviceRoutes`, `serviceContactRoutes`, `campaignRoutes`) —
these still aren't mounted in `server.js` at all, so nothing in them can currently run; not
worth auditing until/unless you decide to wire them in. `districts.js` is a large static
data file (district/upazila names), not logic — not reviewed line by line.

## Still open (needs your own accounts/values, not code changes)

1. Fill in `.env` from `.env.example`: your own `MONGO_URI`, `JWT_SECRET`, SSLCommerz
   sandbox store, SMTP app password. See `README.md`.
2. The original `.env` you shared contained live-looking MongoDB, SMTP, and SSLCommerz
   credentials in plaintext. Do not reuse those old credentials for Footpath — treat them
   as already compromised since they were shared in this conversation.
3. `cus_fax: cus_phone` in `config/sslcommerz.js` reuses the phone number as a fax number —
   harmless (SSLCommerz just wants the field non-empty) but worth knowing it's not a real fax.

## What was intentionally NOT changed in this phase

- Controllers that mix public + admin handlers in one file (e.g. `productController.js`,
  `orderController.js`, `categoryController.js`) were **not** split — admin-ness there is
  enforced per-route via `protect`/`admin` middleware in the route files, not by file
  location. Splitting those cleanly needs a per-handler read of each controller — planned
  as part of the Phase 3 module-by-module audit, same as the Product module.
- No bug fixes applied (route ordering, race conditions, missing validation, etc.) except
  where required to make the rename itself not break anything.
