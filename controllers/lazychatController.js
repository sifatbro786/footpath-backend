import mongoose from "mongoose";
import Order from "../models/Order.js";
import Product from "../models/Product.js";

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
            ? (variantGroup.images || []).map((img) => ({ url: img.url }))
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
// GET /api/lazychat/products
// ─────────────────────────────────────────────
export const getLazychatProducts = async (req, res) => {
    try {
        // Only fetch fields Lazychat needs — avoids pulling huge description/aplusContent fields
        const products = await Product.find({ isActive: true })
            .populate("category", "name slug")
            .select(
                "name slug description metaDescription metaKeywords brand sku isFeatured isActive " +
                    "basePrice discountType discountValue price stock weight " +
                    "imageGroups variantOptions variants hasVariants createdAt updatedAt",
            )
            .lean()
            .maxTimeMS(25000); // 25s max query time

        const transformed = products.map(transformProduct);

        res.json({
            success: true,
            count: transformed.length,
            products: transformed,
        });
    } catch (error) {
        console.error("[Lazychat] getLazychatProducts error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────
// POST /api/lazychat/order/create
// ─────────────────────────────────────────────
export const createLazychatOrder = async (req, res) => {
    try {
        const payload = req.body;
        const {
            contact,
            line_items,
            total_price,
            deliveryCharge,
            payment_method,
            payment_status,
            note,
            id: lazychatOrderId,
        } = payload;

        if (!contact || !line_items || !Array.isArray(line_items) || line_items.length === 0) {
            return res.status(400).json({ success: false, message: "Invalid order payload" });
        }

        const orderItems = [];

        for (const item of line_items) {
            let product = null;

            if (mongoose.Types.ObjectId.isValid(item.product_id)) {
                product = await Product.findById(item.product_id).lean();
            }
            if (!product) {
                product = await Product.findOne({ sku: item.sku }).lean();
            }
            if (!product) {
                return res.status(404).json({
                    success: false,
                    message: `Product not found: ${item.name} (id: ${item.product_id}, sku: ${item.sku})`,
                });
            }

            let variantInfo = null;
            if (product.hasVariants && product.variants?.length > 0) {
                const matchedVariant = product.variants.find(
                    (v) => v.sku === item.sku || v._id?.toString() === item.variation_id,
                );
                if (matchedVariant) {
                    variantInfo = {
                        name: matchedVariant.options.map((o) => o.name).join(" / "),
                        value: matchedVariant.options.map((o) => o.value).join(" / "),
                        sku: matchedVariant.sku,
                    };
                }
            }

            orderItems.push({
                name: item.name,
                product: product._id,
                variant: variantInfo || undefined,
                quantity: item.quantity,
                price: item.price,
                image: item.image || product.imageGroups?.[0]?.images?.[0]?.url || "",
            });
        }

        const addressStr = contact.address || "";
        const isInsideDhaka = addressStr.toLowerCase().includes("dhaka");

        const shippingAddress = {
            name: contact.name,
            phone: contact.phone,
            addressLine1: addressStr,
            district: isInsideDhaka ? "Dhaka" : "Unknown",
            upazila: "",
            locationType: isInsideDhaka ? "inside_dhaka" : "outside_dhaka",
            deliveryType: isInsideDhaka ? "Home Delivery" : "Courier",
            country: "Bangladesh",
        };

        const paymentMethodMap = {
            cash_on_delivery: "COD",
            cod: "COD",
            sslcommerz: "SSLCommerz",
            online: "SSLCommerz",
        };
        const paymentMethod = paymentMethodMap[(payment_method || "").toLowerCase()] || "COD";
        const paymentStatus = payment_status === "paid" ? "Paid" : "Pending";
        const shippingPrice = parseFloat(deliveryCharge) || 0;

        const order = new Order({
            isGuest: true,
            orderItems,
            shippingAddress,
            paymentMethod,
            paymentStatus,
            shippingPrice,
            taxPrice: 0,
            discountAmount: 0,
            totalPrice: total_price,
            orderStatus: "Pending",
            adminNotes: [
                {
                    note:
                        note ||
                        `Order placed via Lazychat AI. Lazychat Order ID: ${lazychatOrderId}`,
                    addedAt: new Date(),
                },
            ],
        });

        const savedOrder = await order.save();

        res.status(201).json({
            success: true,
            message: "Order created successfully",
            order_id: savedOrder._id,
            order_number: savedOrder.orderNumber,
        });
    } catch (error) {
        console.error("[Lazychat] createLazychatOrder error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
