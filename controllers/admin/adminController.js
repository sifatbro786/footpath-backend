import Order from "../../models/Order.js";
import Product from "../../models/Product.js";
import User from "../../models/User.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { escapeRegex } from "../../utils/escapeRegex.js";

// @desc    Get all dashboard analytics
// @route   GET /api/admin/analytics
// @access  Private/Admin
export const getAdminAnalytics = asyncHandler(async (req, res) => {
    // 1. Order Stats
    const orderStats = await Order.aggregate([
        {
            $group: {
                _id: null,
                totalOrders: { $sum: 1 },
                pendingOrders: { $sum: { $cond: [{ $eq: ["$orderStatus", "Pending"] }, 1, 0] } },
                deliveredOrders: {
                    $sum: { $cond: [{ $eq: ["$orderStatus", "Delivered"] }, 1, 0] },
                },
                totalRevenue: {
                    $sum: { $cond: [{ $eq: ["$orderStatus", "Delivered"] }, "$totalPrice", 0] },
                },
            },
        },
        { $project: { _id: 0 } },
    ]);
    const stats = orderStats[0] || {};

    // 2. User Stats
    const userStats = await User.aggregate([
        {
            $group: {
                _id: null,
                totalUsers: { $sum: 1 },
                adminUsers: { $sum: { $cond: [{ $eq: ["$role", "admin"] }, 1, 0] } },
                executiveUsers: { $sum: { $cond: [{ $eq: ["$role", "executive"] }, 1, 0] } },
                regularUsers: { $sum: { $cond: [{ $eq: ["$role", "user"] }, 1, 0] } },
            },
        },
        { $project: { _id: 0 } },
    ]);
    stats.totalUsers = userStats[0]?.totalUsers || 0;
    stats.adminUsers = userStats[0]?.adminUsers || 0;
    stats.executiveUsers = userStats[0]?.executiveUsers || 0;
    stats.regularUsers = userStats[0]?.regularUsers || 0;

    // 3. Product Stats
    const productStats = await Product.aggregate([
        {
            $group: {
                _id: null,
                totalProducts: { $sum: 1 },
                outOfStock: { $sum: { $cond: [{ $eq: ["$stock", 0] }, 1, 0] } },
            },
        },
        { $project: { _id: 0 } },
    ]);
    stats.totalProducts = productStats[0]?.totalProducts || 0;
    stats.outOfStockProducts = productStats[0]?.outOfStock || 0;

    // 4. Category Sales Analysis
    const categorySales = await Order.aggregate([
        { $match: { orderStatus: "Delivered" } },
        { $unwind: "$orderItems" },
        {
            $lookup: {
                from: "products",
                localField: "orderItems.product",
                foreignField: "_id",
                as: "productInfo",
            },
        },
        { $unwind: "$productInfo" },
        {
            $group: {
                _id: "$productInfo.category",
                totalQuantitySold: { $sum: "$orderItems.quantity" },
                totalSalesValue: {
                    $sum: { $multiply: ["$orderItems.quantity", "$orderItems.price"] },
                },
            },
        },
        {
            $lookup: {
                from: "categories",
                localField: "_id",
                foreignField: "_id",
                as: "categoryDetails",
            },
        },
        { $unwind: "$categoryDetails" },
        { $sort: { totalQuantitySold: -1 } },
        { $limit: 3 },
        {
            $project: {
                _id: 0,
                categoryName: "$categoryDetails.name",
                totalQuantitySold: 1,
                totalSalesValue: 1,
            },
        },
    ]);
    stats.topCategories = categorySales;

    // 5. Recent Orders (last 5 orders)
    const recentOrders = await Order.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("user", "name email")
        .select("orderNumber totalPrice orderStatus createdAt");

    stats.recentOrders = recentOrders;

    // 6. Monthly Revenue (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyRevenue = await Order.aggregate([
        {
            $match: {
                orderStatus: "Delivered",
                createdAt: { $gte: sixMonthsAgo },
            },
        },
        {
            $group: {
                _id: {
                    year: { $year: "$createdAt" },
                    month: { $month: "$createdAt" },
                },
                revenue: { $sum: "$totalPrice" },
                orderCount: { $sum: 1 },
            },
        },
        {
            $sort: { "_id.year": 1, "_id.month": 1 },
        },
        {
            $project: {
                _id: 0,
                month: { $concat: [{ $toString: "$_id.year" }, "-", { $toString: "$_id.month" }] },
                revenue: 1,
                orderCount: 1,
            },
        },
    ]);

    stats.monthlyRevenue = monthlyRevenue;

    res.status(200).json({
        success: true,
        stats,
    });
});

// @desc    Get all users
// @route   GET /api/admin/users
// @access  Private/Admin
export const getUsers = async (req, res) => {
    try {
        const { search, role, status, page = 1, limit = 20 } = req.query;

        const filter = {};
        if (role) filter.role = role;
        if (status) filter.status = status;
        if (search) {
            const regex = new RegExp(escapeRegex(search), "i");
            filter.$or = [{ name: regex }, { email: regex }];
        }

        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.max(1, Number(limit) || 20);

        const [users, total] = await Promise.all([
            User.find(filter)
                .select("-password")
                .sort("-createdAt")
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum),
            User.countDocuments(filter),
        ]);

        res.status(200).json({
            success: true,
            count: users.length,
            total,
            page: pageNum,
            pages: Math.ceil(total / limitNum) || 1,
            users,
        });
    } catch (error) {
        console.error("❌ Get users error:", error);
        res.status(500).json({
            success: false,
            message: "Server error while fetching users",
        });
    }
};

// @desc    Create new user (admin only)
// @route   POST /api/admin/users
// @access  Private/Admin
export const createUser = async (req, res) => {
    try {
        const { name, email, phoneNumber, password, role } = req.body;

        // Check if user exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: "User already exists with this email",
            });
        }

        // FIX: only an executive can create another executive-level account.
        if (role === "executive" && req.user.role !== "executive") {
            return res.status(403).json({
                success: false,
                message: "Only an executive can grant the executive role",
            });
        }

        // Create user (auto-verified for admin created users)
        const user = await User.create({
            name,
            email,
            phoneNumber,
            password,
            role: role || "user",
            isEmailVerified: true,
        });

        // Remove password from output
        const userResponse = user.toObject();
        delete userResponse.password;

        res.status(201).json({
            success: true,
            message: "User created successfully",
            user: userResponse,
        });
    } catch (error) {
        console.error("❌ Create user error:", error);

        if (error.name === "ValidationError") {
            const messages = Object.values(error.errors).map((val) => val.message);
            return res.status(400).json({
                success: false,
                message: messages.join(", "),
            });
        }

        res.status(500).json({
            success: false,
            message: "Server error during user creation",
        });
    }
};

// @desc    Update user role
// @route   PUT /api/admin/users/:id/role
// @access  Private/Admin
export const updateUserRole = async (req, res) => {
    try {
        const { role } = req.body;

        // FIX: block self-role-change — otherwise an admin can strip their
        // own access with no one left to reverse it.
        if (req.params.id === req.user.id) {
            return res.status(400).json({
                success: false,
                message: "You cannot change your own role",
            });
        }

        // FIX: only an executive can promote someone to executive.
        if (role === "executive" && req.user.role !== "executive") {
            return res.status(403).json({
                success: false,
                message: "Only an executive can grant the executive role",
            });
        }

        // FIX: an executive account can only be modified by another
        // executive — otherwise a plain admin could demote/strip access
        // from the top-level account.
        const target = await User.findById(req.params.id).select("role");
        if (!target) {
            return res.status(404).json({ success: false, message: "User not found" });
        }
        if (target.role === "executive" && req.user.role !== "executive") {
            return res.status(403).json({
                success: false,
                message: "Only an executive can modify another executive's role",
            });
        }

        const user = await User.findByIdAndUpdate(
            req.params.id,
            { role },
            { new: true, runValidators: true },
        ).select("-password");

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        res.status(200).json({
            success: true,
            message: "User role updated successfully",
            user,
        });
    } catch (error) {
        console.error("❌ Update user role error:", error);
        res.status(500).json({
            success: false,
            message: "Server error during role update",
        });
    }
};
// @desc    Delete user
// @route   DELETE /api/admin/users/:id
// @access  Private/Admin
export const deleteUser = async (req, res) => {
    try {
        // FIX: block self-delete.
        if (req.params.id === req.user.id) {
            return res.status(400).json({
                success: false,
                message: "You cannot delete your own account",
            });
        }

        const target = await User.findById(req.params.id).select("role");
        if (!target) {
            return res.status(404).json({ success: false, message: "User not found" });
        }
        if (target.role === "executive" && req.user.role !== "executive") {
            return res.status(403).json({
                success: false,
                message: "Only an executive can delete another executive's account",
            });
        }

        const user = await User.findByIdAndDelete(req.params.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        res.status(200).json({
            success: true,
            message: "User deleted successfully",
        });
    } catch (error) {
        console.error("❌ Delete user error:", error);
        res.status(500).json({
            success: false,
            message: "Server error during user deletion",
        });
    }
};

// @desc    Get single user
// @route   GET /api/admin/users/:id
// @access  Private/Admin
export const getUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select("-password");

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        res.status(200).json({
            success: true,
            user,
        });
    } catch (error) {
        console.error("❌ Get user error:", error);
        res.status(500).json({
            success: false,
            message: "Server error while fetching user",
        });
    }
};

// @desc    Update user status
// @route   PUT /api/admin/users/:id/status
// @access  Private/Admin
export const updateUserStatus = async (req, res) => {
    try {
        const { status } = req.body;

        // FIX: block self-status-change
        if (req.params.id === req.user.id) {
            return res.status(400).json({
                success: false,
                message: "You cannot change your own status",
            });
        }

        const validStatuses = ["active", "suspended", "inactive"];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid status value",
            });
        }

        const target = await User.findById(req.params.id).select("role");
        if (!target) {
            return res.status(404).json({ success: false, message: "User not found" });
        }
        if (target.role === "executive" && req.user.role !== "executive") {
            return res.status(403).json({
                success: false,
                message: "Only an executive can change another executive's status",
            });
        }

        const user = await User.findByIdAndUpdate(
            req.params.id,
            { status },
            { new: true, runValidators: true },
        ).select("-password");

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        res.status(200).json({
            success: true,
            message: "User status updated successfully",
            user,
        });
    } catch (error) {
        console.error("❌ Update user status error:", error);
        res.status(500).json({
            success: false,
            message: "Server error during status update",
        });
    }
};
