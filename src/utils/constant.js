module.exports = {
      TEXT: {
            BEARER: "Bearer",
            ALGORITHM: "HS256",
      },
      TABLE: {
            LOGIN: "login",
            LOGIN_LOG: "login_log",
            CATEGORIES: "categories",
            SOURCE: "source",
            PRODUCT: 'product',
            WAREHOUSE: 'warehouse'
      },
      CONTEXTS: {
            AUTH: "/api/v1/auth",
            ADMIN: "/api/v1/admin",
            MANAGER: "/api/v1/manager"
      },
      SUB_CONTEXTS: {
            USER: "/user",
            CATEGORY: "/category",
            SUPPLIER_DEALER: "/supplier-dealer",
            PRODUCT: "/product",
            WAREHOUSE: "/warehouse",
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
            GET_CATEGORY_LIST_FOR_DROPDOWN: "/get-category-list-for-dropdown",

            GET_SUPPLIER_DEALER_LIST: "/get-supplier-dealer-list",
            CREATE_SUPPLIER_DEALER: "/create-supplier-dealer",
            UPDATE_SUPPLIER_DEALER_DETAILS: "/update-supplier-dealer-details",
            GET_SUPPLIER_DEALER_DETAILS: "/get-supplier-dealer-details",
            GET_SUPPLIER_DEALER_LIST_FOR_DROPDOWN: "/get-supplier-dealer-list-for-dropdown",

            GET_PRODUCT_LIST: "/get-product-list",
            CREATE_PRODUCT: "/create-product",
            UPDATE_PRODUCT_DETAILS: "/update-product-details",
            GET_PRODUCT_DETAILS: "/get-product-details",
            GET_PRODUCT_LIST_FOR_DROPDOWN: "/get-product-list-for-dropdown",

            GET_WAREHOUSE_LIST: "/get-warehouse-list",
            CREATE_WAREHOUSE: "/create-warehouse",
            UPDATE_WAREHOUSE_DETAILS: "/update-warehouse-details",
            GET_WAREHOUSE_DETAILS: "/get-warehouse-details",
            GET_WAREHOUSE_LIST_FOR_DROPDOWN: "/get-warehouse-list-for-dropdown",
      },
      IMAGE_FILE_UPLOAD_TYPE: ["photo", "report"],
};