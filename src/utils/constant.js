module.exports = {
  TEXT: {
    BEARER: "Bearer",
    ALGORITHM: "HS256",
  },
  TABLE: {
    LOGIN: "login",
    LOGIN_LOG: "login_log",
    CATEGORIES: "categories",
    SUB_CATEGORIES: "sub_categories",
    BRANDS: "brands",
    SUPPLIER: "supplier",
    SOURCE: "source",
    PRODUCT: "product",
    WAREHOUSE: "warehouse",
    AISLE: "aisle",
    PURCHASE: "purchase",
    PURCHASE_DETAILS: "purchase_details",
    PURCHASE_DETAILS_COST_PROFILE: "purchase_details_cost_profile",
    INVENTORY: "inventory",
    PRODUCT_STATS: "product_stats",
    // Order spine (renamed from sales/sales_details). SALES/SALE_DETAILS keys are
    // kept as aliases so legacy controllers resolve to the renamed tables.
    ORDERS: "orders",
    ORDER_ITEMS: "order_items",
    SALES: "orders",
    SALE_DETAILS: "order_items",
    CUSTOMERS: "customers",
    STOCK_HOLD: "stock_hold",
    ORDER_STATUS_HISTORY: "order_status_history",
    // Pre-order: a booking for stock not yet held. Deliberately NOT the orders
    // spine -- a pre-order is part of the sales process but is neither a sale
    // nor an order until it is converted.
    PRE_ORDERS: "pre_orders",
    PRE_ORDER_ITEMS: "pre_order_items",
    PRE_ORDER_STATUS_HISTORY: "pre_order_status_history",
    PRODUCT_RETURN: "product_return",
    RETURN_DETAILS: "return_details",
    PRODUCT_DISPOSE: "product_dispose",
    DISPOSE_DETAILS: "dispose_details",
    OTP_LOG: "otp_log",
    USER_NOTES: "user_notes",
    ACTIVITY_LOG: "activity_log",
    SETTINGS: "settings",
  },
  CONTEXTS: {
    AUTH: "/api/v1/auth",
    ADMIN: "/api/v1/admin",
    PROFILE: "/api/v1/profile",
    CONFIGURATION: "/api/v1/configuration",
    INVENTORY: "/api/v1/inventory",
    ACTIVITY_LOG: "/api/v1/activity-log",
    SALES: "/api/v1/sales",
  },
  SUB_CONTEXTS: {
    USER: "/user",
    CATEGORY: "/category",
    SUB_CATEGORY: "/sub-category",
    BRANDS: "/brands",
    SUPPLIER: "/supplier",
    SUPPLIER_DEALER: "/supplier-dealer",
    PRODUCT: "/product",
    WAREHOUSE: "/warehouse",
    AISLE: "/aisle",
    ANALYTICS: "/analytics",
    SETTINGS: "/settings",
    PURCHASE: "/purchase",
    PURCHASE_ORDER: "/purchase-order",
    INVENTORY_OVERVIEW: "/inventory-overview",
    // Sales & Orders module (revamp)
    POS: "/pos",
    ONLINE: "/online",
    ORDER: "/order",
    PRE_ORDER: "/pre-order",
    // Customer returns against a realized order. Mounted under SALES, not
    // INVENTORY: a return is rooted in an order (product_return.order_oid) and
    // the refund is sales money.
    RETURN: "/return",
    CUSTOMER: "/customer",
    DELIVERY: "/delivery",
    PRODUCT_DISPOSE: "/product-dispose",
    CHANGE_PASSWORD: "/change-password",
    PROFILE_INFO: "/profile-info",
    NOTES: "/notes",
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
    GENERATE_PRODUCT_LIST_REPORT_BY_CATEGORY:
      "/generate-product-list-report-by-category",
    GENERATE_INVENTORY_REPORT_BY_CATEGORY:
      "/generate-inventory-report-by-category",

    GET_SUB_CATEGORY_LIST: "/get-sub-category-list",
    CREATE_SUB_CATEGORY: "/create-sub-category",
    UPDATE_SUB_CATEGORY_DETAILS: "/update-sub-category-details",
    GET_SUB_CATEGORY_DETAILS: "/get-sub-category-details",
    GET_SUB_CATEGORY_LIST_FOR_DROPDOWN: "/get-sub-category-list-for-dropdown",
    GENERATE_PRODUCT_LIST_REPORT_BY_SUB_CATEGORY:
      "/generate-product-list-report-by-sub-category",
    GENERATE_INVENTORY_REPORT_BY_SUB_CATEGORY:
      "/generate-inventory-report-by-sub-category",

    GET_BRANDS_LIST: "/get-brand-list",
    CREATE_BRANDS: "/create-brand",
    UPDATE_BRANDS_DETAILS: "/update-brand-details",
    GET_BRANDS_DETAILS: "/get-brand-details",
    GET_BRANDS_LIST_FOR_DROPDOWN: "/get-brand-list-for-dropdown",
    GENERATE_PRODUCT_LIST_REPORT_BY_BRAND:
      "/generate-product-list-report-by-brand",
    GENERATE_INVENTORY_REPORT_BY_BRAND: "/generate-inventory-report-by-brand",

    GET_SUPPLIER_LIST: "/get-supplier-list",
    CREATE_SUPPLIER: "/create-supplier",
    UPDATE_SUPPLIER_DETAILS: "/update-supplier-details",
    GET_SUPPLIER_DETAILS: "/get-supplier-details",
    GET_SUPPLIER_LIST_FOR_DROPDOWN: "/get-supplier-list-for-dropdown",
    GENERATE_SUPPLIER_PERFORMANCE_REPORT:
      "/generate-supplier-performance-report",
    EXPORT_SUPPLIER_DATA: "/export-supplier-data",

    GET_SUPPLIER_DEALER_LIST: "/get-supplier-dealer-list",
    CREATE_SUPPLIER_DEALER: "/create-supplier-dealer",
    UPDATE_SUPPLIER_DEALER_DETAILS: "/update-supplier-dealer-details",
    GET_SUPPLIER_DEALER_DETAILS: "/get-supplier-dealer-details",
    GET_SUPPLIER_DEALER_LIST_FOR_DROPDOWN:
      "/get-supplier-dealer-list-for-dropdown",

    GET_PRODUCT_LIST: "/get-product-list",
    CREATE_PRODUCT: "/create-product",
    UPDATE_PRODUCT_DETAILS: "/update-product-details",
    GET_PRODUCT_DETAILS: "/get-product-details",
    GET_PRODUCT_LIST_FOR_DROPDOWN: "/get-product-list-for-dropdown",
    DELETE_PRODUCT: "/delete-product",
    GENERATE_PRODUCT_INVENTORY_REPORT: "/generate-product-inventory-report",
    GENERATE_PRODUCT_MOVEMENT_REPORT: "/generate-product-movement-report",

    GET_WAREHOUSE_LIST: "/get-warehouse-list",
    CREATE_WAREHOUSE: "/create-warehouse",
    UPDATE_WAREHOUSE_DETAILS: "/update-warehouse-details",
    GET_WAREHOUSE_DETAILS: "/get-warehouse-details",
    GET_WAREHOUSE_LIST_FOR_DROPDOWN: "/get-warehouse-list-for-dropdown",
    GENERATE_PRODUCT_LIST_REPORT_BY_WAREHOUSE:
      "/generate-product-list-report-by-warehouse",
    GENERATE_INVENTORY_REPORT_BY_WAREHOUSE:
      "/generate-inventory-report-by-warehouse",

    GET_AISLE_LIST: "/get-aisle-list",
    CREATE_AISLE: "/create-aisle",
    UPDATE_AISLE_DETAILS: "/update-aisle-details",
    GET_AISLE_DETAILS: "/get-aisle-details",
    GET_AISLE_LIST_FOR_DROPDOWN: "/get-aisle-list-for-dropdown",
    GENERATE_PRODUCT_LIST_REPORT_BY_AISLE:
      "/generate-product-list-report-by-aisle",
    GENERATE_INVENTORY_REPORT_BY_AISLE: "/generate-inventory-report-by-aisle",

    GET_PURCHASE_LIST: "/get-purchase-list",
    CREATE_PURCHASE: "/create-purchase",
    UPDATE_PURCHASE_DETAILS: "/update-purchase-details",
    GET_PURCHASE_DETAILS: "/get-purchase-details",
    GET_PURCHASE_LIST_FOR_DROPDOWN: "/get-purchase-list-for-dropdown",
    VERIFY_PURCHASE: "/verify-purchase",
    CANCEL_PURCHASE: "/cancel-purchase",

    GET_PRODUCT_LIST_FOR_OVERVIEW: "/get-product-list",
    GET_PRODUCT_DETAILS_FOR_OVERVIEW: "/get-product-details",
    UPDATE_PRICING: "/update-pricing",

    // --- Sales & Orders module (revamp; POS + online on the `orders` spine) ---
    GET_POS_PRODUCT_LIST: "/get-product-list",
    GET_ORDER_INVOICE_NUMBER: "/get-invoice-number",
    CHECKOUT_POS_SALE: "/checkout",
    SAVE_POS_DRAFT: "/save-draft",
    GET_ORDER_LIST: "/get-order-list",
    GET_ORDER_DETAILS: "/get-order-details",
    // Online order page
    SMART_FILL: "/smart-fill",
    CREATE_ONLINE_ORDER: "/create-online-order",
    SAVE_ONLINE_DRAFT: "/save-draft",
    CONFIRM_ONLINE_ORDER: "/confirm",
    CANCEL_ONLINE_ORDER: "/cancel",
    MARK_DELIVERED: "/deliver",
    // Send for Delivery (Pathao export)
    SEND_FOR_DELIVERY: "/send-for-delivery",
    EDIT_PENDING_ORDER: "/edit-pending",

    // --- Returns feature (own router under /api/v1/sales/return) ---
    CREATE_RETURN: "/create-return",
    CONFIRM_RETURN: "/confirm-return",
    CANCEL_RETURN: "/cancel-return",
    MARK_RETURN_REFUNDED: "/mark-refunded",
    GET_RETURN_LIST: "/get-return-list",
    GET_RETURN_LIST_KPIS: "/get-return-list-kpis",
    GET_RETURN_DETAILS: "/get-return-details",
    GET_RETURNS_FOR_ORDER: "/get-returns-for-order",

    // --- Pre-Order feature (own tables; never the `orders` spine) ---
    GET_PRE_ORDER_LIST: "/get-pre-order-list",
    GET_PRE_ORDER_LIST_KPIS: "/get-pre-order-list-kpis",
    GET_PRE_ORDER_DETAILS: "/get-pre-order-details",
    CREATE_PRE_ORDER: "/create-pre-order",
    UPDATE_PRE_ORDER_DETAILS: "/update-pre-order-details",
    CONFIRM_PRE_ORDER: "/confirm-pre-order",
    CANCEL_PRE_ORDER: "/cancel-pre-order",
    RECORD_PRE_ORDER_ADVANCE: "/record-advance",
    GET_PRE_ORDER_NUMBER: "/get-pre-order-number",
    GET_PRE_ORDER_STOCK_READINESS: "/get-stock-readiness",
    GET_BATCHES_FOR_PRODUCT: "/get-batches-for-product",
    MARK_PRE_ORDER_CONVERTED: "/mark-converted",
    GET_PRE_ORDERS_BY_PRODUCT: "/get-pre-orders-by-product",
    GET_READY_TO_CONVERT: "/get-ready-to-convert",
    GET_PRODUCT_LIST_FOR_PRE_ORDER: "/get-product-list-for-pre-order",
    GENERATE_PRE_ORDER_REPORT: "/generate-pre-order-report",
    EXPORT_PRE_ORDER_DATA: "/export-pre-order-data",

    GET_PRODUCT_DISPOSE_LIST: "/get-product-dispose-list",
    CREATE_PRODUCT_DISPOSE: "/create-product-dispose",
    UPDATE_PRODUCT_DISPOSE_DETAILS: "/update-product-dispose-details",
    GET_PRODUCT_DISPOSE_DETAILS: "/get-product-dispose-details",
    APPROVE_PRODUCT_DISPOSE: "/approve-product-dispose",
    REJECT_PRODUCT_DISPOSE: "/reject-product-dispose",
    CANCEL_PRODUCT_DISPOSE: "/cancel-product-dispose",
    REVERSE_PRODUCT_DISPOSE: "/reverse-product-dispose",
    GET_PRODUCT_LIST_FOR_DISPOSE_DROPDOWN:
      "/get-product-list-for-dispose-dropdown",

    CHANGE_PASSWORD: "/change-user-password",
    VERIFY_OTP_FOR_PASSWORD_CHANGE: "/verify-otp-for-password-change",

    GET_PROFILE_INFO: "/get-profile-info",

    GET_ACTIVITY_LOG_LIST: "/get-activity-log-list",

    GET_PURCHASE_ORDER_REPORT: "/get-purchase-order-report",
    GET_PURCHASE_ORDER_PRODUCTS_REPORT: "/get-purchase-order-products-report",

    // Notes
    GET_USER_NOTE_LIST: "/get-note-list",
    GET_USER_NOTE_DETAILS: "/get-note-details",
    CREATE_USER_NOTE: "/create-note",
    UPDATE_USER_NOTE: "/update-note",
    DELETE_USER_NOTE: "/delete-note/:oid",

    // Analytics
    GET_ANALYTICS_METRICS: "/get-analytics-metrics",
    GET_STOCK_TREND: "/get-stock-trend",
    GET_INVENTORY_VALUE_TREND: "/get-inventory-value-trend",
    GET_TOP_PRODUCTS: "/get-top-products",
    GET_PRODUCT_PERFORMANCE: "/get-product-performance",
    GET_STOCK_MOVEMENTS: "/get-stock-movements",
    EXPORT_ANALYTICS_REPORT: "/export-analytics-report",
    GET_CONFIGURATION_DASHBOARD_SUMMARY: "/get-configuration-dashboard-summary",
    GET_SETTINGS: "/get-settings",
    UPDATE_SETTINGS: "/update-settings",
  },
  IMAGE_FILE_UPLOAD_TYPE: ["photo", "report"],
};
