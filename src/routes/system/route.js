const { Router } = require("express");
const { SUB_CONTEXTS } = require("../../utils/constant");
const { featureRouter } = require("./feature/route");

const router = Router();

router.use(SUB_CONTEXTS.FEATURE, featureRouter);

module.exports = { systemRouter: router };
