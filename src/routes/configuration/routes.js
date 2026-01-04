const { Router } = require("express");
const { SUB_CONTEXTS } = require("../../utils/constant");
const { categoryRouter } = require("./category/route");


const router = Router();

// Nest user routes under `/user`
router.use(SUB_CONTEXTS.CATEGORY, categoryRouter);


module.exports = { configurationRouter: router };
