// import AplusContent from "../models/AplusContent.js";
// import Product from "../models/Product.js";
// import { validationResult } from "express-validator";

// // Create or Update A+ Content
// export const createOrUpdateAplusContent = async (req, res) => {
//   try {
//     const errors = validationResult(req);
//     if (!errors.isEmpty()) {
//       return res.status(400).json({
//         success: false,
//         errors: errors.array()
//       });
//     }

//     const { productId, title, sections, isActive = true } = req.body;

//     // Check if product exists
//     const product = await Product.findById(productId);
//     if (!product) {
//       return res.status(404).json({
//         success: false,
//         message: "Product not found"
//       });
//     }

//     // Check if A+ Content already exists
//     let aplusContent = await AplusContent.findOne({ productId });

//     if (aplusContent) {
//       // Update existing
//       aplusContent.title = title || aplusContent.title;
//       aplusContent.sections = sections || aplusContent.sections;
//       aplusContent.isActive = isActive;
//       aplusContent.metaData = {
//         ...aplusContent.metaData,
//         updatedBy: req.user?._id,
//         lastUpdated: new Date()
//       };
//     } else {
//       // Create new
//       aplusContent = new AplusContent({
//         productId,
//         title: title || `A+ Content for ${product.name}`,
//         sections: sections || [],
//         isActive,
//         metaData: {
//           createdBy: req.user?._id,
//           createdAt: new Date()
//         }
//       });
//     }

//     const savedContent = await aplusContent.save();

//     // Update product reference if not already set
//     if (!product.aplusContentId || product.aplusContentId.toString() !== savedContent._id.toString()) {
//       product.aplusContentId = savedContent._id;
//       await product.save();
//     }

//     res.status(200).json({
//       success: true,
//       message: aplusContent.isNew ? "A+ Content created successfully" : "A+ Content updated successfully",
//       aplusContent: savedContent
//     });
//   } catch (error) {
//     console.error('Error saving A+ Content:', error);
//     res.status(500).json({
//       success: false,
//       message: "Error saving A+ Content",
//       error: error.message
//     });
//   }
// };

// // Get A+ Content by Product ID
// export const getAplusContentByProductId = async (req, res) => {
//   try {
//     const { productId } = req.params;

//     const aplusContent = await AplusContent.findOne({
//       productId,
//       isActive: true
//     });

//     if (!aplusContent) {
//       return res.status(404).json({
//         success: false,
//         message: "A+ Content not found for this product"
//       });
//     }

//     res.status(200).json({
//       success: true,
//       aplusContent
//     });
//   } catch (error) {
//     console.error('Error fetching A+ Content:', error);
//     res.status(500).json({
//       success: false,
//       message: "Error fetching A+ Content",
//       error: error.message
//     });
//   }
// };

// // Get A+ Content by Product Slug
// export const getAplusContentByProductSlug = async (req, res) => {
//   try {
//     const { slug } = req.params;

//     // First find the product
//     const product = await Product.findOne({ slug });

//     if (!product) {
//       return res.status(404).json({
//         success: false,
//         message: "Product not found"
//       });
//     }

//     // Then find A+ Content
//     const aplusContent = await AplusContent.findOne({
//       productId: product._id,
//       isActive: true
//     }).select('-metaData -__v');

//     if (!aplusContent) {
//       return res.status(404).json({
//         success: false,
//         message: "A+ Content not found for this product"
//       });
//     }

//     res.status(200).json({
//       success: true,
//       aplusContent: {
//         ...aplusContent.toObject(),
//         productName: product.name,
//         productSlug: product.slug
//       }
//     });
//   } catch (error) {
//     console.error('Error fetching A+ Content:', error);
//     res.status(500).json({
//       success: false,
//       message: "Error fetching A+ Content",
//       error: error.message
//     });
//   }
// };

// // Bulk get A+ Content for multiple products (optimized for product listing)
// export const getBulkAplusContent = async (req, res) => {
//   try {
//     const { productIds } = req.body;

//     if (!Array.isArray(productIds) || productIds.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: "Please provide an array of product IDs"
//       });
//     }

//     // Limit the number of product IDs to prevent abuse
//     const limitedProductIds = productIds.slice(0, 50);

//     const aplusContents = await AplusContent.find({
//       productId: { $in: limitedProductIds },
//       isActive: true
//     }).select('productId title sections -_id');

//     // Convert to object for easy lookup
//     const contentMap = {};
//     aplusContents.forEach(content => {
//       contentMap[content.productId.toString()] = content;
//     });

//     res.status(200).json({
//       success: true,
//       contentMap,
//       count: aplusContents.length
//     });
//   } catch (error) {
//     console.error('Error fetching bulk A+ Content:', error);
//     res.status(500).json({
//       success: false,
//       message: "Error fetching A+ Content",
//       error: error.message
//     });
//   }
// };

// // Toggle A+ Content status
// export const toggleAplusContentStatus = async (req, res) => {
//   try {
//     const { productId } = req.params;

//     const aplusContent = await AplusContent.findOne({ productId });

//     if (!aplusContent) {
//       return res.status(404).json({
//         success: false,
//         message: "A+ Content not found"
//       });
//     }

//     aplusContent.isActive = !aplusContent.isActive;
//     await aplusContent.save();

//     res.status(200).json({
//       success: true,
//       message: `A+ Content ${aplusContent.isActive ? 'activated' : 'deactivated'} successfully`,
//       aplusContent
//     });
//   } catch (error) {
//     console.error('Error toggling A+ Content status:', error);
//     res.status(500).json({
//       success: false,
//       message: "Error toggling A+ Content status",
//       error: error.message
//     });
//   }
// };

// // Delete A+ Content
// export const deleteAplusContent = async (req, res) => {
//   try {
//     const { productId } = req.params;

//     const result = await AplusContent.findOneAndDelete({ productId });

//     if (!result) {
//       return res.status(404).json({
//         success: false,
//         message: "A+ Content not found"
//       });
//     }

//     // Remove reference from product
//     await Product.findByIdAndUpdate(productId, {
//       $unset: { aplusContentId: 1 }
//     });

//     res.status(200).json({
//       success: true,
//       message: "A+ Content deleted successfully"
//     });
//   } catch (error) {
//     console.error('Error deleting A+ Content:', error);
//     res.status(500).json({
//       success: false,
//       message: "Error deleting A+ Content",
//       error: error.message
//     });
//   }
// };

import AplusContent from "../models/AplusContent.js";
import Product from "../models/Product.js";
import { validationResult } from "express-validator";
import { escapeRegex } from "../utils/escapeRegex.js";

// ====================== PUBLIC ROUTES ======================

// Get A+ Content by Product ID (Public)
export const getAplusContentByProductId = async (req, res) => {
    try {
        const { productId } = req.params;

        console.log(`Fetching A+ Content for product ID: ${productId}`);

        const aplusContent = await AplusContent.findOne({
            productId,
            isActive: true,
        });

        if (!aplusContent) {
            return res.status(404).json({
                success: false,
                message: "A+ Content not found for this product",
            });
        }

        res.status(200).json({
            success: true,
            aplusContent,
        });
    } catch (error) {
        console.error("Error fetching A+ Content:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching A+ Content",
            error: error.message,
        });
    }
};

// Get A+ Content by Product Slug (Public)
export const getAplusContentByProductSlug = async (req, res) => {
    try {
        const { slug } = req.params;

        console.log(`Fetching A+ Content for product slug: ${slug}`);

        // First find the product by slug
        const product = await Product.findOne({ slug });

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found",
            });
        }

        // Then find A+ Content
        const aplusContent = await AplusContent.findOne({
            productId: product._id,
            isActive: true,
        }).select("-metaData -__v");

        if (!aplusContent) {
            return res.status(404).json({
                success: false,
                message: "A+ Content not found for this product",
            });
        }

        res.status(200).json({
            success: true,
            aplusContent: {
                ...aplusContent.toObject(),
                productName: product.name,
                productSlug: product.slug,
            },
        });
    } catch (error) {
        console.error("Error fetching A+ Content:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching A+ Content by slug",
            error: error.message,
        });
    }
};

// Get A+ Content by ID (Public/Admin)
export const getAplusContentById = async (req, res) => {
    try {
        const { id } = req.params;

        const aplusContent = await AplusContent.findById(id);

        if (!aplusContent) {
            return res.status(404).json({
                success: false,
                message: "A+ Content not found",
            });
        }

        res.status(200).json({
            success: true,
            aplusContent,
        });
    } catch (error) {
        console.error("Error fetching A+ Content by ID:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching A+ Content",
            error: error.message,
        });
    }
};

// Bulk get A+ Content for multiple products
export const getBulkAplusContent = async (req, res) => {
    try {
        const { productIds } = req.body;

        if (!Array.isArray(productIds) || productIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Please provide an array of product IDs",
            });
        }

        // Limit the number of product IDs to prevent abuse
        const limitedProductIds = productIds.slice(0, 50);

        const aplusContents = await AplusContent.find({
            productId: { $in: limitedProductIds },
            isActive: true,
        }).select("productId title sections -_id");

        // Convert to object for easy lookup
        const contentMap = {};
        aplusContents.forEach((content) => {
            contentMap[content.productId.toString()] = content;
        });

        res.status(200).json({
            success: true,
            contentMap,
            count: aplusContents.length,
        });
    } catch (error) {
        console.error("Error fetching bulk A+ Content:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching A+ Content",
            error: error.message,
        });
    }
};

// ====================== ADMIN ROUTES ======================

// Create or Update A+ Content (Admin)
export const createOrUpdateAplusContent = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array(),
            });
        }

        const { productId, title, sections, isActive = true } = req.body;

        console.log(`Creating/Updating A+ Content for product: ${productId}`);
        console.log("User:", req.user?._id);

        // Check if product exists
        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found",
            });
        }

        // Parse sections if they are stringified
        let parsedSections = sections;
        if (typeof sections === "string") {
            try {
                parsedSections = JSON.parse(sections);
            } catch (parseError) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid sections format",
                });
            }
        }

        // Check if A+ Content already exists
        let aplusContent = await AplusContent.findOne({ productId });

        if (aplusContent) {
            // Update existing
            aplusContent.title = title || aplusContent.title;
            aplusContent.sections = parsedSections || aplusContent.sections;
            aplusContent.isActive = isActive;
            aplusContent.metaData = {
                ...aplusContent.metaData,
                updatedBy: req.user?._id,
                lastUpdated: new Date(),
            };

            console.log("Updating existing A+ Content");
        } else {
            // Create new
            aplusContent = new AplusContent({
                productId,
                title: title || `A+ Content for ${product.name}`,
                sections: parsedSections || [],
                isActive,
                metaData: {
                    createdBy: req.user?._id,
                    createdAt: new Date(),
                },
            });

            console.log("Creating new A+ Content");
        }

        const savedContent = await aplusContent.save();

        // Update product reference if not already set
        if (
            !product.aplusContentId ||
            product.aplusContentId.toString() !== savedContent._id.toString()
        ) {
            product.aplusContentId = savedContent._id;
            await product.save();
            console.log("Updated product reference");
        }

        res.status(200).json({
            success: true,
            message: aplusContent.isNew
                ? "A+ Content created successfully"
                : "A+ Content updated successfully",
            aplusContent: savedContent,
        });
    } catch (error) {
        console.error("Error saving A+ Content:", error);

        // Handle duplicate key error
        if (error.code === 11000 || error.message.includes("duplicate key")) {
            return res.status(400).json({
                success: false,
                message: "A+ Content already exists for this product",
                error: "Duplicate productId",
            });
        }

        res.status(500).json({
            success: false,
            message: "Error saving A+ Content",
            error: error.message,
        });
    }
};

// Get all A+ Content (Admin)
export const getAllAplusContent = async (req, res) => {
    try {
        const { page = 1, limit = 20, search = "", status = "all" } = req.query;

        const query = {};

        // Search functionality
        if (search) {
            query.$or = [
                { title: { $regex: escapeRegex(search), $options: "i" } },
                { "metaData.createdBy": { $regex: escapeRegex(search), $options: "i" } },
            ];
        }

        // Status filter
        if (status !== "all") {
            query.isActive = status === "active";
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [aplusContents, total] = await Promise.all([
            AplusContent.find(query)
                .populate({
                    path: "productId",
                    select: "name sku images category",
                    populate: {
                        path: "category",
                        select: "name",
                    },
                })
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            AplusContent.countDocuments(query),
        ]);

        res.status(200).json({
            success: true,
            aplusContents,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        console.error("Error fetching A+ Content:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching A+ Content",
            error: error.message,
        });
    }
};

// Toggle A+ Content status (Admin)
export const toggleAplusContentStatus = async (req, res) => {
    try {
        const { productId } = req.params;

        console.log(`Toggling status for product: ${productId}`);
        console.log("User:", req.user?._id);

        const aplusContent = await AplusContent.findOne({ productId });

        if (!aplusContent) {
            return res.status(404).json({
                success: false,
                message: "A+ Content not found",
            });
        }

        const newStatus = !aplusContent.isActive;
        aplusContent.isActive = newStatus;

        // Update metadata
        aplusContent.metaData = {
            ...aplusContent.metaData,
            updatedBy: req.user?._id,
            lastUpdated: new Date(),
            lastStatusChange: {
                date: new Date(),
                changedBy: req.user?._id,
                from: !newStatus,
                to: newStatus,
            },
        };

        await aplusContent.save();

        console.log(`Status toggled to: ${newStatus ? "active" : "inactive"}`);

        res.status(200).json({
            success: true,
            message: `A+ Content ${newStatus ? "activated" : "deactivated"} successfully`,
            aplusContent: {
                _id: aplusContent._id,
                productId: aplusContent.productId,
                isActive: aplusContent.isActive,
                title: aplusContent.title,
            },
        });
    } catch (error) {
        console.error("Error toggling A+ Content status:", error);
        res.status(500).json({
            success: false,
            message: "Error toggling A+ Content status",
            error: error.message,
            details: process.env.NODE_ENV === "development" ? error.stack : undefined,
        });
    }
};

// Delete A+ Content (Admin)
export const deleteAplusContent = async (req, res) => {
    try {
        const { productId } = req.params;

        console.log(`Deleting A+ Content for product: ${productId}`);
        console.log("User:", req.user?._id);

        const result = await AplusContent.findOneAndDelete({ productId });

        if (!result) {
            return res.status(404).json({
                success: false,
                message: "A+ Content not found",
            });
        }

        // Remove reference from product
        await Product.findByIdAndUpdate(productId, {
            $unset: { aplusContentId: 1 },
        });

        console.log("A+ Content deleted successfully");

        res.status(200).json({
            success: true,
            message: "A+ Content deleted successfully",
            deletedContent: {
                _id: result._id,
                productId: result.productId,
                title: result.title,
            },
        });
    } catch (error) {
        console.error("Error deleting A+ Content:", error);
        res.status(500).json({
            success: false,
            message: "Error deleting A+ Content",
            error: error.message,
        });
    }
};

// Get admin dashboard A+ Content (Admin)
export const getAdminAplusContent = async (req, res) => {
    try {
        const { page = 1, limit = 50, search = "" } = req.query;

        const query = {};

        if (search) {
            query.$or = [
                { title: { $regex: escapeRegex(search), $options: "i" } },
                { "productId.name": { $regex: escapeRegex(search), $options: "i" } },
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [aplusContents, total] = await Promise.all([
            AplusContent.find(query)
                .populate({
                    path: "productId",
                    select: "name sku images price isActive",
                })
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            AplusContent.countDocuments(query),
        ]);

        res.status(200).json({
            success: true,
            aplusContents,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        console.error("Error fetching admin A+ Content:", error);
        res.status(500).json({
            success: false,
            message: "Error fetching A+ Content",
            error: error.message,
        });
    }
};
