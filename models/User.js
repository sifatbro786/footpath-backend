import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, "Name is required"],
            trim: true,
            maxlength: 100,
        },
        email: {
            type: String,
            required: [true, "Email is required"],
            unique: true,
            lowercase: true,
            trim: true,
            match: [/\S+@\S+\.\S+/, "Please use a valid email address"],
        },
        password: {
            type: String,
            required: [true, "Password is required"],
            minlength: [6, "Password must be at least 6 characters"],
            select: false,
        },
        phoneNumber: {
            type: String,
            trim: true,
        },
        role: {
            type: String,
            enum: ["user", "admin", "editor", "executive"],
            default: "user",
        },
        isEmailVerified: {
            type: Boolean,
            default: false,
        },
        emailVerificationOTP: String,
        emailVerificationOTPExpire: Date,
        resetPasswordOTP: String,
        resetPasswordOTPExpire: Date,
        profilePicture: {
            type: String,
            default: "",
        },
        dateOfBirth: Date,
        gender: {
            type: String,
            enum: ["male", "female", "other", ""],
            default: "",
        },
        shippingAddress: [
            {
                fullName: { type: String, required: true },
                phoneNumber: { type: String, required: true },
                addressLine1: { type: String, required: true },
                addressLine2: { type: String },
                city: { type: String, required: true },
                state: { type: String, required: true },
                zipCode: { type: String, required: true },
                country: { type: String, required: true, default: "Bangladesh" },
                isDefault: { type: Boolean, default: false },
                addressType: {
                    type: String,
                    enum: ["home", "office", "other"],
                    default: "home",
                },
            },
        ],
        preferences: {
            newsletter: { type: Boolean, default: true },
            smsNotifications: { type: Boolean, default: false },
            emailNotifications: { type: Boolean, default: true },
        },
        lastLogin: Date,
        loginCount: {
            type: Number,
            default: 0,
        },
        status: {
            type: String,
            enum: ["active", "suspended", "inactive"],
            default: "active",
        },
    },
    {
        timestamps: true,
    },
);

// Hash password before saving
userSchema.pre("save", async function (next) {
    if (!this.isModified("password")) {
        return next();
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

// Update last login on successful login
userSchema.methods.updateLoginInfo = function () {
    this.lastLogin = new Date();
    this.loginCount += 1;
    return this.save();
};

// Match password
userSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

// Generate JWT token
userSchema.methods.getSignedJwtToken = function () {
    return jwt.sign(
        {
            id: this._id,
            role: this.role,
            email: this.email,
        },
        process.env.JWT_SECRET,
        {
            expiresIn: process.env.JWT_EXPIRE,
        },
    );
};

userSchema.methods.generateEmailVerificationOTP = function () {
    const OTP = Math.floor(100000 + Math.random() * 900000).toString();

    this.emailVerificationOTP = crypto.createHash("sha256").update(OTP).digest("hex");

    this.emailVerificationOTPExpire = Date.now() + 10 * 60 * 1000;

    return OTP;
};

userSchema.methods.generateResetPasswordOTP = function () {
    const OTP = Math.floor(100000 + Math.random() * 900000).toString();

    this.resetPasswordOTP = crypto.createHash("sha256").update(OTP).digest("hex");

    this.resetPasswordOTPExpire = Date.now() + 10 * 60 * 1000;

    return OTP;
};

// Check if email verification OTP is valid
userSchema.methods.isEmailVerificationOTPValid = function () {
    return this.emailVerificationOTPExpire > Date.now();
};

// Check if reset password OTP is valid
userSchema.methods.isResetPasswordOTPValid = function () {
    return this.resetPasswordOTPExpire > Date.now();
};

const User = mongoose.model("User", userSchema);
export default User;
