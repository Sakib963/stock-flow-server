const { log } = require("../../../../utils/log");
const { PHOTO_FOLDER, upload_signature } = require("../../../../utils/cloudinary-photo");

// The browser uploads the photo straight to Cloudinary, as a product photo is, into the people
// folder only; the server only vouches for the upload.
const sign_profile_photo_upload = async (request, res) => {
    const signed = upload_signature(PHOTO_FOLDER.people);
    if (!signed) {
        log.error("Profile photo upload asked for, but CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY or CLOUDINARY_API_SECRET is not set");
        return res.status(503).json({ code: 503, message: "Photo upload is not set up on this server yet. Save your profile without a photo for now." });
    }
    return res.status(200).json({ code: 200, message: "OK", data: signed });
};

module.exports = sign_profile_photo_upload;
