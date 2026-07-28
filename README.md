# Footpath — E-commerce Backend

Express + MongoDB (Mongoose) backend. Restructured from the original codebase into an
industry-standard MVC layout so this can be reused as a base for future e-commerce projects.

## Folder Structure

```
footpath-backend/
├── config/                # database.js, sslcommerz.js
├── models/                # Mongoose schemas — PascalCase (Product.js, Order.js...)
├── controllers/            # business logic — camelCase (productController.js...)
│   └── admin/               # admin-only controllers (adminController.js, heroAdminController.js...)
├── routes/                 # Express routers — public/user-facing only
│   └── admin/                # every admin-only route, mounted under /api/admin/...
├── middlewares/             # authMiddleware.js, errorMiddleware.js, rateLimiter.js, upload.js...
├── services/                # emailService.js, pricingService.js, campaignService.js...
├── utils/                   # asyncHandler.js, apiFeatures.js, escapeRegex.js, makeSlug.js...
├── scripts/                  # one-time setup scripts (seedShippingRates.js)
├── uploads/                  # local file storage (gitignored)
└── server.js
```

**Route convention:** every file in `routes/` is public or requires only a logged-in user
(`protect`) — never admin-only. Anything admin-only lives in `routes/admin/`, one file per
resource, each with `router.use(protect, admin)` at the top instead of repeating the
middleware per-route. All admin endpoints are mounted under `/api/admin/...` in
`server.js` — see `MIGRATION_NOTES.md` → "Phase 5" for the full before/after mapping and
the URL changes that came with it.

## Install

```bash
npm install
cp .env.example .env
# now fill in the values in .env (see below)
npm run seed:shipping   # one-time — creates default shipping rates so checkout works
npm run dev
```

Requires Node.js 18+ (uses ES Modules — `"type": "module"` in package.json).

## `.env` — what to fill in

| Variable                                            | কী দিতে হবে                                                                                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONGO_URI`                                         | তোমার নিজের MongoDB Atlas cluster (বা local MongoDB) connection string — নিজের নতুন cluster বানাও, পুরনো project এর credential ব্যবহার কোরো না |
| `JWT_SECRET`                                        | নতুন random string (`openssl rand -hex 32` দিয়ে জেনারেট করতে পারো)                                                                            |
| `SSLCOMMERZ_STORE_ID` / `SSLCOMMERZ_STORE_PASSWORD` | [SSLCommerz Developer Portal](https://developer.sslcommerz.com) এ নিজের sandbox store খুলে নাও (ফ্রি)                                          |
| `SMTP_USER` / `SMTP_PASS`                           | নিজের Gmail + [App Password](https://myaccount.google.com/apppasswords) (২-স্টেপ ভেরিফিকেশন চালু থাকতে হবে)                                    |
| `CLIENT_URL`, `FRONTEND_URL`, `SITE_URL`            | তোমার frontend এর dev/prod URL                                                                                                                 |
| `CLOUDINARY_*`                                      | (optional) যদি cloud image storage ব্যবহার করো                                                                                                 |

⚠️ `.env` কখনো git এ commit কোরো না — `.gitignore` এ আগে থেকেই আছে।

## Known Issues / TODO (see `MIGRATION_NOTES.md`)

Full audit trail — every bug found and fixed, phase by phase, from the initial file
restructure through the full admin-route split — is documented in `MIGRATION_NOTES.md`.
Worth a read before building the frontend, especially the "Remaining lower-priority items"
section at the end for what genuinely hasn't been touched yet.
