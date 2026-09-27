const { log } = require("../../../../utils/log");
const { upload_signature } = require("../utils/photo");

// The browser uploads the photo straight to Cloudinary, so the file never passes through this
// server and the person sees real progress; the server only vouches for the upload.
const sign_product_photo_upload = async (request, res) => {
      const signed = upload_signature();
      if (!signed) {
            log.error("Photo upload asked for, but CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY or CLOUDINARY_API_SECRET is not set");
            return res.status(503).json({ code: 503, message: "Photo upload is not set up on this server yet. Save the product without a photo and add one later." });
      }
      return res.status(200).json({ code: 200, message: "OK", data: signed });
};

module.exports = sign_product_photo_upload;
