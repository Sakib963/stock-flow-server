const crypto = require("crypto");

// Where each kind of photo lands in our Cloudinary account. A signature names its folder, so an
// upload signed for a person's photo cannot land among the products, nor the other way round.
const PHOTO_FOLDER = { products: "stockflow/products", people: "stockflow/people" };

const cloud_name = () => process.env.CLOUDINARY_CLOUD_NAME || "";

/** Whether this is an image delivered from our own Cloudinary account, and from `folder` when one is named. Without a cloud name configured, nothing is. */
const is_own_photo = (url, folder = null) => {
    const cloud = cloud_name();
    if (!cloud || !url.startsWith(`https://res.cloudinary.com/${cloud}/image/upload/`)) return false;
    return !folder || url.includes(`/${folder}/`);
};

// Cloudinary's rule: the signed parameters sorted by name, joined as a query string, the API secret
// appended, SHA-1 in hex. Only folder and timestamp are signed, so an upload with this signature can
// land in that folder and nowhere else, and only for the next hour.
const sign = (params, secret) =>
    crypto
        .createHash("sha1")
        .update(
            Object.keys(params)
                .sort()
                .map((key) => `${key}=${params[key]}`)
                .join("&") + secret
        )
        .digest("hex");

/** What the browser needs to upload one photo straight to Cloudinary into `folder`, or null when upload is not set up here. */
const upload_signature = (folder) => {
    const { CLOUDINARY_API_KEY: api_key, CLOUDINARY_API_SECRET: secret } = process.env;
    const cloud = cloud_name();
    if (!cloud || !api_key || !secret) return null;

    const timestamp = Math.floor(Date.now() / 1000);
    return { cloud_name: cloud, api_key, folder, timestamp, signature: sign({ folder, timestamp }, secret) };
};

module.exports = { PHOTO_FOLDER, is_own_photo, sign, upload_signature };
