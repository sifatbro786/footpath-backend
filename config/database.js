import mongoose from "mongoose";

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("==========================================");
        console.log("Database Connection: Successful 🎉");
        console.log("==========================================");
    } catch (err) {
        console.error("Database Connection Failed:", err.message);
        process.exit(1);
    }
};

export default connectDB;
