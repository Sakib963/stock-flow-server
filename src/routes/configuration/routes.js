const { Router } = require("express");
const { SUB_CONTEXTS } = require("../../utils/constant");
const { categoryRouter } = require("./category/route");
const { subCategoryRouter } = require("./sub-category/route");
const { brandRouter } = require("./brands/route");


const router = Router();

// Nest user routes under `/user`
router.use(SUB_CONTEXTS.CATEGORY, categoryRouter);
router.use(SUB_CONTEXTS.SUB_CATEGORY, subCategoryRouter);
router.use(SUB_CONTEXTS.BRANDS,brandRouter);


module.exports = { configurationRouter: router };
