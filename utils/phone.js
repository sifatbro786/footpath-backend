// utils/phone.js
// Bangladesh mobile numbers come in many shapes from old spreadsheets and the
// checkout form: "+8801712-345678", "8801712345678", "01712 345678",
// "1712345678" (Excel ate the leading 0). Everything is stored as the 11 digit
// local form "01XXXXXXXXX" so one person is one Customer row.

/** @returns {string|null} "01XXXXXXXXX" or null when it is not a BD mobile */
export const normalizeBdPhone = (raw) => {
    if (raw === undefined || raw === null) return null;
    let d = String(raw).replace(/\D/g, "");
    if (d.startsWith("00880")) d = d.slice(5);
    else if (d.startsWith("880")) d = d.slice(3);
    if (d.length === 10 && d.startsWith("1")) d = `0${d}`;
    return /^01[3-9]\d{8}$/.test(d) ? d : null;
};
