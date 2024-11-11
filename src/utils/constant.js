module.exports = {
      SCHEMA: {
            COMMON: "public.",
      },
      TEXT: {
            BEARER: "Bearer",
            ALGORITHM: "HS256",
            SENT_OTP: "SentOtp",
            FAILED_OTP: "FailedOtp",
            ACTIVE: "Active",
      },
      METHOD: {
            CREATE: "create",
            READ: "read",
            UPDATE: "update",
            DELETE: "delete",
      },
      TABLE: {
            LOGIN: "login",
      },
      IMAGE_FILE_UPLOAD_TYPE: ["photo", "report"],
      MESSAGE: {
            SUCCESS_GET_LIST: "Successfully found list",
            SUCCESS_GET_BY_OID: "Successfully found item",
            INTERNAL_SERVER_ERROR: "Something bad happened. Please try again later!",
            SUCCESS_SAVE: "Successfully saved",
            SUCCESS_DELETE: "Successfully deleted"
      },
};