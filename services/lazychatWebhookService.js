/**
 * lazychat.webhook.service.js
 *
 * Call these functions from your product controller after create/update/delete.
 *
 * Usage in product.controller.js:
 *
 *   import { notifyLazychatProductChange, notifyLazychatProductDelete } from './lazychatWebhookService.js';
 *
 *   // After createProduct:
 *   await notifyLazychatProductChange('product/create', savedProduct);
 *
 *   // After updateProduct:
 *   await notifyLazychatProductChange('product/update', updatedProduct);
 *
 *   // After deleteProduct:
 *   await notifyLazychatProductDelete(productId);
 */

import fetch from "node-fetch"; // already available in Node 18+; if older use: npm i node-fetch

const CREATE_UPDATE_ENDPOINT =
    "https://flow.lazychat.io/api/exec/flows/6a43a64b0b6fca38d8469871/8nJg7jwCqPSk";
const CREATE_UPDATE_TOKEN = "3aa602b6e5ad17c9ca7e5555e974577f510ddc8e9a86c245095fb2af3c8f0ff9";

const DELETE_ENDPOINT =
    "https://flow.lazychat.io/api/exec/flows/6a43a64b0b6fca38d8469871/09CdJz92KBmw";
const DELETE_TOKEN = "3c31c9d831a975b835a44065caafc197ac36ebc0a1ed0ac945982a66eaa2f8d6";

// ─────────────────────────────────────────────
// Transform DB product → Lazychat format
// (same logic as controller — kept here to avoid circular imports)
// ─────────────────────────────────────────────
const transformProduct = (product) => {
    const BASE_URL = process.env.SITE_URL || "https://www.innoelbd.com";

    const allImages = (product.imageGroups || []).flatMap((group) =>
        (group.images || []).map((img) => ({ url: img.url })),
    );

    const attributes = (product.variantOptions || []).map((opt, idx) => ({
        id: idx + 1,
        name: opt.name,
        values: opt.values,
    }));

    const variations = (product.variants || []).map((variant, idx) => {
        const isOnSale = variant.discountType !== "none" && variant.discountValue > 0;
        const finalPrice = isOnSale ? variant.basePrice - variant.discountValue : variant.basePrice;

        const variantGroup = (product.imageGroups || []).find(
            (g) => g.name === variant.imageGroupName,
        );
        const variantImages = variantGroup
            ? variantGroup.images.map((img) => ({ url: img.url }))
            : allImages.slice(0, 1);

        return {
            id: variant._id?.toString() || `${product._id}-v${idx}`,
            title: variant.options.map((o) => o.value).join(" / "),
            sku: variant.sku || "",
            published: product.isActive !== false,
            weight: String(product.weight || ""),
            pricing: {
                regular_price: String(variant.basePrice),
                sale_prices: isOnSale ? [{ price: String(finalPrice) }] : [],
            },
            inventory: {
                stock_status: variant.stock > 0,
                stocks: [{ quantity: variant.stock }],
            },
            images: variantImages,
            attributes: variant.options.map((o, i) => ({
                id: i + 1,
                name: o.name,
                value: o.value,
            })),
            created_at: product.createdAt,
            updated_at: product.updatedAt,
        };
    });

    const isOnSale =
        product.discountType !== "none" &&
        product.discountValue > 0 &&
        product.price < product.basePrice;

    return {
        id: product._id.toString(),
        title: product.name,
        slug: product.slug,
        url: `${BASE_URL}/products/${product.slug}`,
        description: product.description || "",
        summary: product.metaDescription || "",
        published: product.isActive !== false,
        is_draft: false,
        featured: product.isFeatured || false,
        purchasable: product.stock > 0 || (product.variants || []).some((v) => v.stock > 0),
        sku: product.sku || "",
        brand: product.brand || "",
        weight: String(product.weight || ""),
        tags: product.metaKeywords || [],
        note: "",
        categories: product.category
            ? [
                  {
                      id: product.category._id?.toString() || product.category.toString(),
                      title: product.category.name || "",
                      slug: product.category.slug || "",
                  },
              ]
            : [],
        images: allImages,
        attributes,
        pricing: {
            regular_price: String(product.basePrice),
            sale_prices: isOnSale ? [{ price: String(product.price) }] : [],
        },
        inventory: {
            stock_status: product.stock > 0,
            stocks: [{ quantity: product.stock }],
        },
        variations,
        created_at: product.createdAt,
        updated_at: product.updatedAt,
    };
};

// ─────────────────────────────────────────────
// Notify Lazychat: product created or updated
// topic: 'product/create' | 'product/update'
// ─────────────────────────────────────────────
export const notifyLazychatProductChange = async (topic, product) => {
    try {
        const body = transformProduct(product);

        const res = await fetch(CREATE_UPDATE_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${CREATE_UPDATE_TOKEN}`,
                "X-Webhook-Topic": topic,
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const text = await res.text();
            console.error(`[Lazychat Webhook] ${topic} failed (${res.status}):`, text);
        } else {
            console.log(`[Lazychat Webhook] ${topic} sent for product: ${product._id}`);
        }
    } catch (err) {
        // Non-blocking — log and continue
        console.error(`[Lazychat Webhook] ${topic} error:`, err.message);
    }
};

// ─────────────────────────────────────────────
// Notify Lazychat: product deleted
// ─────────────────────────────────────────────
export const notifyLazychatProductDelete = async (productId) => {
    try {
        const res = await fetch(DELETE_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${DELETE_TOKEN}`,
                "X-Webhook-Topic": "product/delete",
            },
            body: JSON.stringify({ product_id: productId.toString() }),
        });

        if (!res.ok) {
            const text = await res.text();
            console.error(`[Lazychat Webhook] product/delete failed (${res.status}):`, text);
        } else {
            console.log(`[Lazychat Webhook] product/delete sent for product: ${productId}`);
        }
    } catch (err) {
        console.error(`[Lazychat Webhook] product/delete error:`, err.message);
    }
};
