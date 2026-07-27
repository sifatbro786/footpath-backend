export const notFound = (req, res, next) => {
    const error = new Error(`Not Found - ${req.originalUrl}`);
    res.status(404);
    next(error);
};

export const errorHandler = (err, req, res, next) => {
    let statusCode = res.statusCode === 200 ? 500 : res.statusCode;
    let message = err.message;

    if (err.name === "CastError") {
        message = "Resource not found";
        statusCode = 404;
    }

    if (err.code === 11000) {
        message = "Duplicate field value entered";
        statusCode = 400;
    }

    if (err.name === "ValidationError" && err.errors) {
        message = Object.values(err.errors)
            .map((val) => val.message)
            .join(", ");
        statusCode = 400;
    }

    res.status(statusCode).json({
        success: false,
        error: message,
        ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
    });
};
