const express = require("express");
const authRouter = require('./src/routes/auth/routes');
const app = express();
const cors = require('cors');
const { CONTEXTS } = require("./src/utils/constant");

const port = 3000;

app.use(express.json());
app.use(cors());


app.get('/', (req, res) => {
      res.send(`StockFlow Server is running`)
})

app.use(CONTEXTS.AUTH, authRouter)

app.listen(port, () => console.log(`StockFlow Server is listening on port ${port}`));
