import slugify from "slugify";

export const makeSlug = (text) => {
    return slugify(text, {
        lower: true,
        strict: true,
        remove: /[*+~.()'"!:@]/g,
    });
};
