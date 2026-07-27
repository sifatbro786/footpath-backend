// controllers/pageMetaController.js
// Extracted from the old root-level "pageMeta.js" (which mixed router + logic).
import PageMeta from "../models/PageMeta.js";

export const createPageMeta = async (req, res) => {
    try {
        const { pageName, metaTitle, metaDescription, metaKeywords, canonicalUrl, lastUpdatedBy } =
            req.body;

        if (!pageName || !metaTitle || !metaDescription || !metaKeywords || !canonicalUrl) {
            return res.status(400).json({
                success: false,
                message:
                    "All fields are required: pageName, metaTitle, metaDescription, metaKeywords, canonicalUrl",
            });
        }

        const existingPage = await PageMeta.findOne({
            pageName: pageName.trim(),
        });

        if (existingPage) {
            return res.status(400).json({
                success: false,
                message: "Page name already exists",
            });
        }

        const newPageMeta = new PageMeta({
            pageName: pageName.trim(),
            metaTitle: metaTitle.trim(),
            metaDescription: metaDescription.trim(),
            metaKeywords: metaKeywords.trim(),
            canonicalUrl: canonicalUrl.trim(),
            lastUpdatedBy: lastUpdatedBy || "admin",
        });

        const savedPageMeta = await newPageMeta.save();

        res.status(201).json({
            success: true,
            data: savedPageMeta,
            message: "Page meta created successfully",
        });
    } catch (error) {
        if (error.name === "ValidationError") {
            return res.status(400).json({
                success: false,
                message: "Validation error",
                error: error.message,
            });
        }
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: "Page name or slug already exists",
            });
        }
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
};

export const getAllPageMeta = async (req, res) => {
    try {
        const pageMeta = await PageMeta.find().sort({ pageName: 1 }).select("-__v");

        res.json({
            success: true,
            data: pageMeta,
            count: pageMeta.length,
            message: "All page meta data fetched successfully",
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
};

export const getPageMetaBySlug = async (req, res) => {
    try {
        const pageMeta = await PageMeta.findOne({
            pageSlug: req.params.slug,
            isActive: true,
        }).select("-__v");

        if (!pageMeta) {
            return res.status(404).json({
                success: false,
                message: "Page meta not found",
            });
        }

        res.json({
            success: true,
            data: pageMeta,
            message: "Page meta fetched successfully",
        });
    } catch (error) {
        if (error.name === "CastError") {
            return res.status(404).json({
                success: false,
                message: "Page meta not found",
            });
        }
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
};


export const updatePageMeta = async (req, res) => {
    try {
        const {
            pageName,
            metaTitle,
            metaDescription,
            metaKeywords,
            canonicalUrl,
            isActive,
            lastUpdatedBy,
        } = req.body;

        const existingPage = await PageMeta.findById(req.params.id);
        if (!existingPage) {
            return res.status(404).json({
                success: false,
                message: "Page meta not found",
            });
        }

        if (pageName && pageName !== existingPage.pageName) {
            const duplicatePage = await PageMeta.findOne({
                $and: [{ _id: { $ne: req.params.id } }, { pageName: pageName.trim() }],
            });

            if (duplicatePage) {
                return res.status(400).json({
                    success: false,
                    message: "Page name already exists",
                });
            }
        }

        const updateFields = {};
        if (pageName !== undefined) updateFields.pageName = pageName.trim();
        if (metaTitle !== undefined) updateFields.metaTitle = metaTitle.trim();
        if (metaDescription !== undefined) updateFields.metaDescription = metaDescription.trim();
        if (metaKeywords !== undefined) updateFields.metaKeywords = metaKeywords.trim();
        if (canonicalUrl !== undefined) updateFields.canonicalUrl = canonicalUrl.trim();
        if (isActive !== undefined) updateFields.isActive = isActive;
        if (lastUpdatedBy !== undefined) updateFields.lastUpdatedBy = lastUpdatedBy;

        const updatedPageMeta = await PageMeta.findByIdAndUpdate(
            req.params.id,
            { $set: updateFields },
            { new: true, runValidators: true },
        ).select("-__v");

        res.json({
            success: true,
            data: updatedPageMeta,
            message: "Page meta updated successfully",
        });
    } catch (error) {
        if (error.name === "CastError") {
            return res.status(404).json({
                success: false,
                message: "Page meta not found",
            });
        }
        if (error.name === "ValidationError") {
            return res.status(400).json({
                success: false,
                message: "Validation error",
                error: error.message,
            });
        }
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: "Page name or slug already exists",
            });
        }
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
};

export const deletePageMeta = async (req, res) => {
    try {
        const deletedPageMeta = await PageMeta.findByIdAndDelete(req.params.id);

        if (!deletedPageMeta) {
            return res.status(404).json({
                success: false,
                message: "Page meta not found",
            });
        }

        res.json({
            success: true,
            message: "Page meta deleted successfully",
            deletedId: deletedPageMeta._id,
        });
    } catch (error) {
        if (error.name === "CastError") {
            return res.status(404).json({
                success: false,
                message: "Page meta not found",
            });
        }
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
};

export const togglePageMetaStatus = async (req, res) => {
    try {
        const pageMeta = await PageMeta.findById(req.params.id);

        if (!pageMeta) {
            return res.status(404).json({
                success: false,
                message: "Page meta not found",
            });
        }

        pageMeta.isActive = !pageMeta.isActive;
        pageMeta.lastUpdatedBy = req.body.lastUpdatedBy || "admin";

        const updatedPageMeta = await pageMeta.save();

        res.json({
            success: true,
            data: updatedPageMeta,
            message: `Page ${updatedPageMeta.isActive ? "activated" : "deactivated"} successfully`,
        });
    } catch (error) {
        if (error.name === "CastError") {
            return res.status(404).json({
                success: false,
                message: "Page meta not found",
            });
        }
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
};

export const bulkUpdatePageMeta = async (req, res) => {
    try {
        const { pages } = req.body;

        if (!Array.isArray(pages)) {
            return res.status(400).json({
                success: false,
                message: "Pages array is required",
            });
        }

        const bulkOperations = pages.map((page) => ({
            updateOne: {
                filter: { _id: page.id },
                update: {
                    $set: {
                        metaTitle: page.metaTitle,
                        metaDescription: page.metaDescription,
                        metaKeywords: page.metaKeywords,
                        canonicalUrl: page.canonicalUrl,
                        lastUpdatedBy: page.lastUpdatedBy || "admin",
                    },
                },
            },
        }));

        const result = await PageMeta.bulkWrite(bulkOperations);

        res.json({
            success: true,
            message: "Bulk update completed successfully",
            modifiedCount: result.modifiedCount,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
};
