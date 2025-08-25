const JWT = require("jsonwebtoken");
const { TEXT, TABLE } = require("./constant");
const { v4: uuidv4 } = require('uuid');
const { log } = require("./log");
const { execute_value, get_data } = require("./database");

const generate_token = (token) => {
  return JWT.sign(
    { token },
    process.env.ACCESS_TOKEN_SECRET,
    {
      expiresIn: process.env.ACCESS_TOKEN_SECRET_EXPIRE,
      algorithm: TEXT.ALGORITHM,
    }
  );
};

const refresh_token = (token) => {
  return JWT.sign(
    { token },
    process.env.REFRESH_TOKEN_SECRET,
    {
      expiresIn: process.env.REFRESH_TOKEN_SECRET_EXPIRE,
      algorithm: TEXT.ALGORITHM,
    }
  );
};

const generateRandomString = () => {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let randomString = "";
  for (let i = 0; i < 12; i++) {
    const randomIndex = crypto.randomInt(characters.length);
    randomString += characters[randomIndex];
  }
  return randomString.toUpperCase();
}

const update_login_log = async (token, ref_token) => {
  let sql = {
    text: `insert into ${TABLE.LOGIN_LOG} (oid, signin_time, access_token, refresh_token, status) values ($1, clock_timestamp(), $2, $3, $4)`,
    values: [uuidv4(), token, ref_token, 'Signin']
  }
  try {
    await execute_value(sql);
  } catch (e) {
    log.error(`An exception occurred while updating sign in log: ${e.message}`);
  }
}

const get_access_token_from_db = async (accessToken) => {
  const sql = {
    text: `
      SELECT l.status, l.signout_time 
      FROM ${TABLE.LOGIN_LOG} l
      WHERE l.access_token = $1
    `,
    values: [accessToken],
  };

  try {
    const dataSet = await get_data(sql);
    return dataSet[0] || null;
  } catch (error) {
    console.error('Error fetching access token from DB:', error.message);
    return null;
  }
};

const generate_OTP = () => Math.floor(100000 + Math.random() * 900000).toString();

const save_generated_otp = async (user_id) => {
  const otp_oid = uuidv4();
  const otp = generate_OTP();
  const sql = {
    text: `INSERT INTO ${TABLE.OTP_LOG} (oid, user_id, otp, expires_at, status) values ($1, $2, $3, $4, $5)`,
    values: [otp_oid, user_id, otp, new Date(Date.now() + 15 * 60 * 1000), 'Active']
  }
  try {
    await execute_value(sql);
    log.info(`Generated OTP - ${otp} for user: ${user_id}`);
  } catch (e) {
    log.error(`An exception occurred while saving generated OTP: ${e.message}`);
    return null;
  }
  return {otp, otp_oid};
};

module.exports = {
  generate_token,
  refresh_token,
  generateRandomString,
  update_login_log,
  get_access_token_from_db,
  save_generated_otp
};