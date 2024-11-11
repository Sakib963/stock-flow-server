const { TABLE } = require("../../utils/constant");
const database = require('../../utils/database');
const { log } = require("../../utils/log");

const createUser = (req, res) => {
  res.send("Creating user");
};

const getAllUser = async (req, res) => {
  let data = null;
  const sql = {
    text: `SELECT * FROM ${TABLE.LOGIN}`,
    values: []
  }

  try {
    const data_set = await database.get_data(sql);
    data = data_set
  } catch (e) {
    log.error(`An exception occurred while getting all user: ${e?.message}`)
  }
  res.send(data);
};


module.exports = {
  createUser,
  getAllUser
}   