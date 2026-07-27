import mongoose from "mongoose";

const pageMetaSchema = new mongoose.Schema(
    {
        pageName: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },
        pageSlug: {
            type: String,
            unique: true,
            trim: true,
            lowercase: true,
        },
        metaTitle: {
            type: String,
            required: true,
            trim: true,
        },
        metaDescription: {
            type: String,
            required: true,
            trim: true,
        },
        metaKeywords: {
            type: String,
            required: true,
            trim: true,
        },
        canonicalUrl: {
            type: String,
            required: true,
            trim: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        lastUpdatedBy: {
            type: String,
            default: "admin",
        },
    },
    {
        timestamps: true,
    },
);

pageMetaSchema.pre("save", function (next) {
    if (this.isModified("pageName") || !this.pageSlug) {
        this.pageSlug = this.pageName
            .toLowerCase()
            .replace(/[^a-zA-Z0-9]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "");
    }
    next();
});

pageMetaSchema.pre("findOneAndUpdate", function (next) {
    const update = this.getUpdate();

    if (update.pageName) {
        const slug = update.pageName
            .toLowerCase()
            .replace(/[^a-zA-Z0-9]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "");

        this.setUpdate({
            ...update,
            pageSlug: slug,
        });
    }
    next();
});

const PageMeta = mongoose.model("PageMeta", pageMetaSchema);

export default PageMeta;
