const express = require("express");
const app = express();
const cors = require('cors');
const mainRouter = require("./src/routes/routes");

const port = 3000;

app.use(express.json());
app.use(cors());


app.get('/', (req, res) => {
      res.send(`StockFlow Server is running`)
})

app.use("/", mainRouter);

app.listen(port, () => console.log(`StockFlow Server is listening on port ${port}`));
