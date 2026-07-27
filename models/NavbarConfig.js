import mongoose from "mongoose";

const navbarItemSchema = new mongoose.Schema({
    _id: {
        type: String,
        default: () => `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    },
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 50,
    },
    type: {
        type: String,
        enum: ["category", "custom", "link"],
        required: true,
    },
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
        default: null,
    },
    customUrl: {
        type: String,
        default: "",
    },
    path: {
        type: String,
        default: "",
    },
    order: {
        type: Number,
        default: 0,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
});

const navbarConfigSchema = new mongoose.Schema(
    {
        logo: {
            url: {
                type: String,
                default: "",
            },
            public_id: {
                type: String,
                default: "",
            },
        },
        logoUrl: {
            type: String,
            default: "/",
        },
        items: [navbarItemSchema],
        cartIcon: {
            type: Boolean,
            default: true,
        },
        searchIcon: {
            type: Boolean,
            default: true,
        },
        userIcon: {
            type: Boolean,
            default: true,
        },
        wishlistIcon: {
            type: Boolean,
            default: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
    },
);

navbarItemSchema.pre("save", function (next) {
    if (this.type === "category" && this.category && !this.path) {
        this.path = `/category/${this.category}`;
    } else if (this.type === "custom" && this.customUrl) {
        this.path = this.customUrl;
    }
    next();
});

const NavbarConfig = mongoose.model("NavbarConfig", navbarConfigSchema);
export default NavbarConfig;
