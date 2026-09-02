import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import hpp from "hpp";
import dotenv from "dotenv";
import morgan from "morgan";
import { errorHandler, notFound } from "./middlewares/errorMiddleware.js";
import { sanitizeRequest } from "./middlewares/sanitize.js";
import { globalApiLimiter } from "./middlewares/rateLimiter.js";

// ============= PUBLIC / USER ROUTES =============
import categoryRoutes from "./routes/categoryRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import cartRoutes from "./routes/cartRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import checkoutRoutes from "./routes/checkoutRoutes.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import heroContentRoutes from "./routes/heroContentRoutes.js";
import heroRoutes from "./routes/heroRoutes.js";
import navbarRoutes from "./routes/navbarRoutes.js";
import couponRoutes from "./routes/couponRoutes.js";
import aplusContentRoutes from "./routes/aplusContentRoutes.js";
import pageMetaRoutes from "./routes/pageMetaRoutes.js";
import productCampaignRoutes from "./routes/productCampaignRoutes.js";
import offerPopupRoutes from "./routes/offerPopupRoutes.js";
import wishlistRoutes from "./routes/wishlistRoutes.js";

// ============= ADMIN ROUTES (all live under routes/admin/) =============
import adminRoutes from "./routes/admin/adminRoutes.js";
import adminOrderRoutes from "./routes/admin/adminOrderRoutes.js";
import analyticsRoutes from "./routes/admin/analyticsRoutes.js";
import adminCartRoutes from "./routes/admin/adminCartRoutes.js";
import adminShippingRoutes from "./routes/admin/adminShippingRoutes.js";
import productAdminRoutes from "./routes/admin/productAdminRoutes.js";
import couponAdminRoutes from "./routes/admin/couponAdminRoutes.js";
import heroAdminRoutes from "./routes/admin/heroAdminRoutes.js";
import heroContentAdminRoutes from "./routes/admin/heroContentAdminRoutes.js";
import offerPopupAdminRoutes from "./routes/admin/offerPopupAdminRoutes.js";
import productCampaignAdminRoutes from "./routes/admin/productCampaignAdminRoutes.js";
import reviewAdminRoutes from "./routes/admin/reviewAdminRoutes.js";
import categoryAdminRoutes from "./routes/admin/categoryAdminRoutes.js";
import navbarAdminRoutes from "./routes/admin/navbarAdminRoutes.js";
import uploadAdminRoutes from "./routes/admin/uploadAdminRoutes.js";
import aplusContentAdminRoutes from "./routes/admin/aplusContentAdminRoutes.js";
import pageMetaAdminRoutes from "./routes/admin/pageMetaAdminRoutes.js";

import cron from "node-cron";
import ProductCampaignService from "./services/productCampaignService.js";

import path from "path";
import { fileURLToPath } from "url";
import connectDB from "./config/database.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

connectDB();

// ═══ Middleware pipeline (Phase 0) ═══════════════════════════════════════════
// Order is load-bearing. Read top to bottom:
//   compression  – must wrap res.write/end before anything writes a response
//   helmet       – security headers on every response, including static + errors
//   static       – /uploads served after helmet so it inherits those headers
//   cors         – must resolve before any route work, and before the limiter,
//                  so a rejected preflight still gets correct CORS headers
//   body parsers – populate req.body for the sanitiser below
//   sanitize     – strips Mongo operators; ALSO re-defines req.query as a
//                  writable property, which hpp depends on (see sanitize.js)
//   hpp          – collapses duplicated params (?id=1&id=2 -> array attacks)
//   limiter      – applied to /api only; static assets and /health stay free

app.use(compression());

app.use(helmet({
    // /uploads is fetched cross-origin by the storefront (different port in dev,
    // different domain in prod). Helmet's default CORP of "same-origin" makes
    // browsers refuse those images.
    crossOriginResourcePolicy: { policy: "cross-origin" },
}));

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// CORS origins are built from .env (CLIENT_URL / FRONTEND_URL) rather than
// hardcoded — add Footpath's real domains there.
const envOrigins = [process.env.CLIENT_URL, ...(process.env.FRONTEND_URL || "").split(",")]
    .map((o) => o && o.trim())
    .filter(Boolean);

const allowedOrigins = [
    ...new Set([
        ...envOrigins,
        "http://localhost:5173",
        "http://localhost:5174",
        "https://footpathbd.com",
        "https://www.footpathbd.com",
        "https://sandbox.sslcommerz.com",
        "https://securepay.sslcommerz.com",
    ]),
];

app.use(
    cors({
        origin: function (origin, callback) {
            if (!origin || origin === "null") {
                return callback(null, true);
            }
            if (allowedOrigins.indexOf(origin) !== -1) {
                callback(null, true);
            } else {
                console.log(`CORS Error: Blocked origin ${origin}`);
                callback(new Error("Not allowed by CORS"));
            }
        },
        credentials: true,
        allowedHeaders: ["Content-Type", "Authorization"],
    }),
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// NoSQL operator injection guard. Must precede hpp — see middlewares/sanitize.js
// for why Express 5 needs a custom wrapper here.
app.use(sanitizeRequest);

// HTTP parameter pollution. `whitelist` names params that are legitimately
// repeatable; everything else collapses to its last value so a handler can
// never receive an unexpected array where it expects a string.
app.use(
    hpp({
        whitelist: ["category", "attributes", "brand", "tags", "sort", "ids"],
    }),
);

if (process.env.NODE_ENV !== "production") {
    app.use(morgan("dev"));
}

// Blanket rate limit for the API surface. Tighter per-route limiters (auth, OTP,
// coupon) are mounted inside their own routers and stack on top of this.
app.use("/api", globalApiLimiter);

// ============= PUBLIC / USER ROUTES =============
app.use(`/api/categories`, categoryRoutes);
app.use(`/api/products`, productRoutes);
app.use(`/api/auth`, authRoutes);
app.use(`/api/cart`, cartRoutes);
app.use(`/api/orders`, orderRoutes);
app.use(`/api/payment`, paymentRoutes);
app.use(`/api/checkout`, checkoutRoutes);
app.use(`/api/reviews`, reviewRoutes);
app.use(`/api/hero`, heroContentRoutes);
app.use(`/api/hero-items`, heroRoutes);
app.use(`/api/navbar`, navbarRoutes);
app.use(`/api/coupons`, couponRoutes);
app.use(`/api/aplus-content`, aplusContentRoutes);
app.use(`/api/page-meta`, pageMetaRoutes);
app.use(`/api/product-campaigns`, productCampaignRoutes);
app.use(`/api/offers`, offerPopupRoutes);
app.use(`/api/wishlist`, wishlistRoutes);

// ============= ADMIN ROUTES (all mounted under /api/admin/...) =============
app.use(`/api/admin`, adminRoutes);
app.use(`/api/admin/orders`, adminOrderRoutes);
app.use(`/api/admin/analytics`, analyticsRoutes);
app.use(`/api/admin/cart-campaigns`, adminCartRoutes);
app.use(`/api/admin/shipping`, adminShippingRoutes);
app.use(`/api/admin/products`, productAdminRoutes);
app.use(`/api/admin/coupons`, couponAdminRoutes);
app.use(`/api/admin/hero-items`, heroAdminRoutes);
app.use(`/api/admin/hero-content`, heroContentAdminRoutes);
app.use(`/api/admin/offers`, offerPopupAdminRoutes);
app.use(`/api/admin/product-campaigns`, productCampaignAdminRoutes);
app.use(`/api/admin/reviews`, reviewAdminRoutes);
app.use(`/api/admin/categories`, categoryAdminRoutes);
app.use(`/api/admin/navbar`, navbarAdminRoutes);
app.use(`/api/admin/upload`, uploadAdminRoutes);
app.use(`/api/admin/aplus-content`, aplusContentAdminRoutes);
app.use(`/api/admin/page-meta`, pageMetaAdminRoutes);

app.get("/health", (req, res) => {
    res.status(200).json({
        status: "OK",
        message: "Footpath API is running smoothly!",
        environment: process.env.NODE_ENV || "development",
        timestamp: new Date().toISOString(),
    });
});

cron.schedule("* * * * *", async () => {
    try {
        const result = await ProductCampaignService.processAllActiveCampaigns();
        if (result.started.length > 0 || result.ended.length > 0) {
            console.log(`Campaign Update:`);
            if (result.started.length > 0) {
                console.log(` New Campaign Started: ${result.started.length} `);
                result.started.forEach((c) =>
                    console.log(`      - ${c.name}: ${c.productsApplied} Applied products`),
                );
            }
            if (result.ended.length > 0) {
                console.log(`  Campaign ended: ${result.ended.length} `);
                result.ended.forEach((c) =>
                    console.log(`      - ${c.name}: ${c.productsRolledBack} total roleback`),
                );
            }
        } else {
            console.log(`No new campaign start or end`);
        }
        console.log(`========================================`);
    } catch (error) {
        console.error(`Having some problem to start campaign:`, error.message);
        console.error(error);
    }
});

app.use(notFound);
app.use(errorHandler);

app.listen(PORT, () => {
    console.log("==========================================");
    console.log(`Server is Live!`);
    console.log(`URL: http://localhost:${PORT}/api`);
    console.log(`Mode: ${process.env.NODE_ENV || "development"}`);
    console.log("==========================================");
});
