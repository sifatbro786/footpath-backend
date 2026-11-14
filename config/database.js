import mongoose from "mongoose";

const connectDB = async () => {
    try {
        // MONGODB_URI is this project's name; MONGO_URI kept as a fallback for base parity.
        await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
        console.log("==========================================");
        console.log("Database Connection: Successful 🎉");
        console.log("==========================================");
    } catch (err) {
        console.error("Database Connection Failed:", err.message);
        process.exit(1);
    }
};

export default connectDB;
