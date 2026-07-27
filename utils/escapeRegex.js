// utils/escapeRegex.js
// Escapes regex special characters in user-supplied search strings before
// building a RegExp / Mongo $regex query from them. Without this, a crafted
// search string with catastrophic backtracking can hang the query (ReDoS) —
// on the Node process if used with JS RegExp, or on the database itself if
// passed straight into a Mongo $regex filter.
export const escapeRegex = (str = "") => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
