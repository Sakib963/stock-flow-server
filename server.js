const express = require("express");
const app = express();
const cors = require("cors");
const mainRouter = require("./src/routes/routes");
const { COMPANY_INFO } = require("./src/utils/company-info");
const { request_log } = require("./src/middleware/request-log");

const PORT = process.env.PORT || 3000;

// Behind Vercel's proxy. Without this Express reports the proxy's address as req.ip, which would
// put every caller in one rate-limit bucket. 1 means trust exactly one hop, the platform edge.
app.set("trust proxy", 1);

// Credentials are allowed so the refresh cookie can travel. With no allow-list the caller's origin
// is reflected, which is only acceptable because the cookie is SameSite=Strict: a page on another
// site cannot make the browser send it. Set CORS_ORIGINS in production regardless.
const allowedOrigins = (process.env.CORS_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true, credentials: true }));

// After cors so preflights are not logged, before the parser so malformed JSON is.
app.use(request_log);

app.use(express.json());

app.get("/", (req, res) => {
  res.send(`${COMPANY_INFO.serverDisplayName} is running`);
});

app.use("/", mainRouter);

// Only when run directly. Vercel and the tests import the app and bind it themselves.
if (require.main === module) {
  app.listen(PORT, () =>
    console.log(`${COMPANY_INFO.serverDisplayName} is listening on port ${PORT}`),
  );
}

// Required for Vercel
module.exports = app;
