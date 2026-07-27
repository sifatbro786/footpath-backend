// FIX: escape regex special characters so user-controlled search input can't
// be used to build a catastrophic-backtracking pattern (ReDoS) or otherwise
// change the intended match behavior.
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// FIX: only these comparison operators are allowed through from query params.
// Anything else ($where, $regex, $expr, etc.) is stripped — without this, a
// client could send e.g. ?price[$where]=... or ?price[$regex]=... directly
// (only bare "gte/gt/lte/lt" words were being prefixed with "$" before; an
// already-prefixed operator key passed straight through untouched).
const ALLOWED_OPERATORS = new Set(["$gte", "$gt", "$lte", "$lt", "$in", "$ne"]);

const sanitizeQueryObject = (obj) => {
    if (Array.isArray(obj)) {
        return obj.map(sanitizeQueryObject);
    }
    if (obj && typeof obj === "object") {
        const clean = {};
        for (const [key, value] of Object.entries(obj)) {
            if (key.startsWith("$")) {
                if (ALLOWED_OPERATORS.has(key)) {
                    clean[key] = sanitizeQueryObject(value);
                }
                // any other $-operator key is silently dropped
                continue;
            }
            clean[key] = sanitizeQueryObject(value);
        }
        return clean;
    }
    return obj;
};

export class APIFeatures {
    constructor(query, queryString) {
        this.query = query;
        this.queryString = queryString;
    }

    filter() {
        const queryObj = { ...this.queryString };
        const excludedFields = ["page", "sort", "limit", "fields", "search"];
        excludedFields.forEach((el) => delete queryObj[el]);

        // Advanced filtering
        let queryStr = JSON.stringify(queryObj);
        queryStr = queryStr.replace(/\b(gte|gt|lte|lt)\b/g, (match) => `$${match}`);

        const parsed = JSON.parse(queryStr);
        this.query = this.query.find(sanitizeQueryObject(parsed));
        return this;
    }

    search(searchFields = ["name", "description"]) {
        if (this.queryString.search) {
            const searchRegex = new RegExp(escapeRegex(this.queryString.search), "i");
            const searchQuery = {
                $or: searchFields.map((field) => ({ [field]: searchRegex })),
            };
            this.query = this.query.find(searchQuery);
        }
        return this;
    }

    sort() {
        if (this.queryString.sort) {
            const sortBy = this.queryString.sort.split(",").join(" ");
            this.query = this.query.sort(sortBy);
        } else {
            this.query = this.query.sort("-createdAt");
        }
        return this;
    }

    limitFields() {
        if (this.queryString.fields) {
            const fields = this.queryString.fields.split(",").join(" ");
            this.query = this.query.select(fields);
        } else {
            this.query = this.query.select("-__v");
        }
        return this;
    }

    paginate() {
        const page = this.queryString.page * 1 || 1;
        const limit = this.queryString.limit * 1 || 10;
        const skip = (page - 1) * limit;

        this.query = this.query.skip(skip).limit(limit);
        return this;
    }
}
