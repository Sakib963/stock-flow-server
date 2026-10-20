const { Router } = require("express");
const { SUB_CONTEXTS } = require("../../utils/constant");
const { observabilityRouter } = require("./observability/route");

const router = Router();

router.use(SUB_CONTEXTS.OBSERVABILITY, observabilityRouter);

module.exports = { systemRouter: router };
