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
    const update = this.getUpdate() || {};
    // The controller sends { $set: { pageName, ... } }, so pageName lives under
    // $set — not at the top level. Support both shapes, otherwise renaming a
    // page never regenerates its slug and the old slug stays resolvable.
    const nextName = update.pageName ?? update.$set?.pageName;
    if (nextName) {
        const slug = nextName
            .toLowerCase()
            .replace(/[^a-zA-Z0-9]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "");
        if (update.$set) update.$set.pageSlug = slug;
        else update.pageSlug = slug;
        this.setUpdate(update);
    }
    next();
});

const PageMeta = mongoose.model("PageMeta", pageMetaSchema);

export default PageMeta;
