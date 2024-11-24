module.exports = {
      TEXT: {
            BEARER: "Bearer",
            ALGORITHM: "HS256",
      },
      TABLE: {
            LOGIN: "login",
            LOGIN_LOG: "login_log",
      },
      CONTEXTS: {
            AUTH: "/api/v1/auth",
            ADMIN: "/api/v1/admin"
      },
      SUB_CONTEXTS: {
            USER: "/user",
      },
      ROUTES: {
            SIGN_IN: "/sign-in",
            REFRESH_TOKEN: "/refresh-token",
            GET_USER_INFO: "/get-user-info",
            GET_USER_LIST: "/get-user-list"
      },
      IMAGE_FILE_UPLOAD_TYPE: ["photo", "report"],
};