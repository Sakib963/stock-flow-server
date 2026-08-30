const express = require("express");
const app = express();
const cors = require("cors");
const mainRouter = require("./src/routes/routes");
const { COMPANY_INFO } = require("./src/utils/company-info");

const PORT = process.env.PORT || 3000;

// Behind Vercel's proxy. Without this Express reports the proxy's address as req.ip, which would
// put every caller in one rate-limit bucket. 1 means trust exactly one hop, the platform edge.
app.set("trust proxy", 1);

app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
  res.send(`${COMPANY_INFO.serverDisplayName} is running`);
});

app.use("/", mainRouter);

app.listen(PORT, () =>
  console.log(`${COMPANY_INFO.serverDisplayName} is listening on port ${PORT}`),
);

// Required for Vercel
module.exports = app;
