const { log } = require("../../../../utils/log");
const { PHOTO_FOLDER, upload_signature } = require("../../../../utils/cloudinary-photo");

// The browser uploads the logo straight to Cloudinary into the branding folder only, as a product
// or a profile photo is; the server only vouches for the upload.
const sign_settings_logo_upload = async (request, res) => {
    const signed = upload_signature(PHOTO_FOLDER.branding);
    if (!signed) {
        log.error("Logo upload asked for, but CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY or CLOUDINARY_API_SECRET is not set");
        return res.status(503).json({ code: 503, message: "Photo upload is not set up on this server yet. Save the settings without a logo for now." });
    }
    return res.status(200).json({ code: 200, message: "OK", data: signed });
};

module.exports = sign_settings_logo_upload;
