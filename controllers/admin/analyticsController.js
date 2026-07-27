import mongoose from "mongoose";
import Order from "../../models/Order.js";
import Product from "../../models/Product.js";
import Category from "../../models/Category.js";
import User from "../../models/User.js";

// @desc    Get comprehensive analytics dashboard data
// @route   GET /api/v1/admin/analytics/dashboard
// @access  Private/Admin
export const getDashboardAnalytics = async (req, res, next) => {
    try {
        const { period = "monthly" } = req.query; // daily, weekly, monthly, yearly

        // Date ranges based on period
        const getDateRange = () => {
            const now = new Date();
            switch (period) {
                case "daily":
                    return {
                        start: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
                        end: now,
                    };
                case "weekly":
                    const weekStart = new Date(now);
                    weekStart.setDate(now.getDate() - now.getDay());
                    weekStart.setHours(0, 0, 0, 0);
                    return { start: weekStart, end: now };
                case "monthly":
                    return {
                        start: new Date(now.getFullYear(), now.getMonth(), 1),
                        end: now,
                    };
                case "yearly":
                    return {
                        start: new Date(now.getFullYear(), 0, 1),
                        end: now,
                    };
                default:
                    return {
                        start: new Date(now.getFullYear(), now.getMonth(), 1),
                        end: now,
                    };
            }
        };

        const { start, end } = getDateRange();

        // Basic stats
        const totalOrders = await Order.countDocuments();
        const pendingOrders = await Order.countDocuments({ orderStatus: "Pending" });
        const deliveredOrders = await Order.countDocuments({ orderStatus: "Delivered" });
        const totalProducts = await Product.countDocuments({ isActive: true });
        const totalUsers = await User.countDocuments({ status: "active" });

        // Revenue calculation
        // FIX: this used to also compute a "profit" / "profitMargin" by summing
        // `$itemsPrice` — a field that doesn't exist anywhere on the Order
        // schema (only shippingPrice/taxPrice/discountAmount/totalPrice do), so
        // totalCost was always 0 and profitMargin was always a fake 100%.
        // Removed rather than ship a made-up number. To show real profit, add a
        // `costPrice` field to the Product model and sum it per order item here.
        const revenueData = await Order.aggregate([
            {
                $match: {
                    orderStatus: "Delivered",
                    createdAt: { $gte: start, $lte: end },
                },
            },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: "$totalPrice" },
                },
            },
        ]);

        const totalRevenue = revenueData[0]?.totalRevenue || 0;

        // Category-wise sales
        const categorySales = await Order.aggregate([
            {
                $match: {
                    orderStatus: "Delivered",
                    createdAt: { $gte: start, $lte: end },
                },
            },
            { $unwind: "$orderItems" },
            {
                $lookup: {
                    from: "products",
                    localField: "orderItems.product",
                    foreignField: "_id",
                    as: "productData",
                },
            },
            { $unwind: "$productData" },
            {
                $lookup: {
                    from: "categories",
                    localField: "productData.category",
                    foreignField: "_id",
                    as: "categoryData",
                },
            },
            { $unwind: "$categoryData" },
            {
                $group: {
                    _id: "$categoryData._id",
                    categoryName: { $first: "$categoryData.name" },
                    totalSales: {
                        $sum: { $multiply: ["$orderItems.quantity", "$orderItems.price"] },
                    },
                    totalItems: { $sum: "$orderItems.quantity" },
                    orderCount: { $addToSet: "$_id" },
                },
            },
            {
                $project: {
                    categoryName: 1,
                    totalSales: 1,
                    totalItems: 1,
                    orderCount: { $size: "$orderCount" },
                },
            },
            { $sort: { totalSales: -1 } },
        ]);

        // Top selling products
        const topProducts = await Order.aggregate([
            {
                $match: {
                    orderStatus: "Delivered",
                    createdAt: { $gte: start, $lte: end },
                },
            },
            { $unwind: "$orderItems" },
            {
                $group: {
                    _id: "$orderItems.product",
                    productName: { $first: "$orderItems.name" },
                    totalSold: { $sum: "$orderItems.quantity" },
                    totalRevenue: {
                        $sum: { $multiply: ["$orderItems.quantity", "$orderItems.price"] },
                    },
                },
            },
            { $sort: { totalSold: -1 } },
            { $limit: 10 },
        ]);

        // Sales trend (last 7 days)
        const salesTrend = await Order.aggregate([
            {
                $match: {
                    orderStatus: "Delivered",
                    createdAt: {
                        $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                        $lte: new Date(),
                    },
                },
            },
            {
                $group: {
                    _id: {
                        $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
                    },
                    dailySales: { $sum: "$totalPrice" },
                    orderCount: { $sum: 1 },
                },
            },
            { $sort: { _id: 1 } },
        ]);

        // Payment method distribution
        const paymentMethods = await Order.aggregate([
            {
                $match: {
                    createdAt: { $gte: start, $lte: end },
                },
            },
            {
                $group: {
                    _id: "$paymentMethod",
                    count: { $sum: 1 },
                    totalAmount: { $sum: "$totalPrice" },
                },
            },
        ]);

        res.status(200).json({
            success: true,
            data: {
                overview: {
                    totalOrders,
                    pendingOrders,
                    deliveredOrders,
                    totalProducts,
                    totalUsers,
                    totalRevenue,
                },
                categorySales,
                topProducts,
                salesTrend,
                paymentMethods,
                period,
                dateRange: { start, end },
            },
        });
    } catch (error) {
        console.error("Analytics dashboard error:", error);
        next(error);
    }
};

// @desc    Get sales report with filters
// @route   GET /api/v1/admin/analytics/sales-report
// @access  Private/Admin
export const getSalesReport = async (req, res, next) => {
    try {
        const { startDate, endDate, category, paymentMethod } = req.query;

        let matchStage = { orderStatus: "Delivered" };

        // Date filter
        if (startDate && endDate) {
            matchStage.createdAt = {
                $gte: new Date(startDate),
                $lte: new Date(endDate),
            };
        }

        // Payment method filter
        if (paymentMethod && paymentMethod !== "all") {
            matchStage.paymentMethod = paymentMethod;
        }

        const salesReport = await Order.aggregate([
            { $match: matchStage },
            { $unwind: "$orderItems" },
            {
                $lookup: {
                    from: "products",
                    localField: "orderItems.product",
                    foreignField: "_id",
                    as: "productData",
                },
            },
            { $unwind: "$productData" },
            {
                $lookup: {
                    from: "categories",
                    localField: "productData.category",
                    foreignField: "_id",
                    as: "categoryData",
                },
            },
            { $unwind: "$categoryData" },
            ...(category && category !== "all"
                ? [{ $match: { "categoryData._id": new mongoose.Types.ObjectId(category) } }]
                : []),
            {
                $group: {
                    _id: {
                        date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                        productId: "$orderItems.product",
                        productName: "$orderItems.name",
                        categoryName: "$categoryData.name",
                    },
                    quantitySold: { $sum: "$orderItems.quantity" },
                    totalRevenue: {
                        $sum: { $multiply: ["$orderItems.quantity", "$orderItems.price"] },
                    },
                    averagePrice: { $avg: "$orderItems.price" },
                },
            },
            { $sort: { "_id.date": -1, totalRevenue: -1 } },
        ]);

        res.status(200).json({
            success: true,
            count: salesReport.length,
            data: salesReport,
        });
    } catch (error) {
        console.error("Sales report error:", error);
        next(error);
    }
};
