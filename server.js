const express = require("express");
const app = express();
const cors = require("cors");
const mainRouter = require("./src/routes/routes");
const { COMPANY_INFO } = require("./src/utils/company-info");

const PORT = process.env.PORT || 3000;

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
