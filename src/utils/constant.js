module.exports = {
      TEXT: {
            BEARER: "Bearer",
            ALGORITHM: "HS256",
      },
      TABLE: {
            LOGIN: "login",
            LOGIN_LOG: "login_log",
            CATEGORIES: "categories"
      },
      CONTEXTS: {
            AUTH: "/api/v1/auth",
            ADMIN: "/api/v1/admin",
            MANAGER: "/api/v1/manager"
      },
      SUB_CONTEXTS: {
            USER: "/user",
            CATEGORY: "/category",
      },
      ROUTES: {
            SIGN_IN: "/sign-in",
            REFRESH_TOKEN: "/refresh-token",
            GET_USER_INFO: "/get-user-info",
            GET_USER_LIST: "/get-user-list",
            CREATE_USER: "/create-user",
            UPDATE_USER_DETAILS: "/update-user-details",
            GET_USER_DETAILS: "/get-user-details",

            GET_CATEGORY_LIST: "/get-category-list",
            CREATE_CATEGORY: "/create-category",
            UPDATE_CATEGORY_DETAILS: "/update-category-details",
            GET_CATEGORY_DETAILS: "/get-category-details",
      },
      IMAGE_FILE_UPLOAD_TYPE: ["photo", "report"],
};