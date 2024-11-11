const express = require("express");
const authRouter = require('./src/routes/auth/routes');
const app = express();


const port = 3000;

app.get('/', (req, res) => {
      res.send(`StockFlow Server is running`)
})

app.use('/api/v1/auth', authRouter)

app.listen(port, () => console.log(`StockFlow Server is listening on port ${port}`));
