const JWT = require("jsonwebtoken");
const { TEXT, TABLE } = require("./constant");
const { v4: uuidv4 } = require('uuid');
const { log } = require("./log");
const { execute_value, get_data } = require("./database");
const crypto = require("crypto");

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

// crypto.randomInt, not Math.random: Math.random is not a cryptographic source and its output is
// predictable from enough samples. On the unauthenticated recovery route this code is the only
// thing standing between a stranger and an account.
const generate_OTP = () => crypto.randomInt(100000, 1000000).toString();

const OTP_TTL_MINUTES = 15;

const save_generated_otp = async (user_id) => {
  const otp_oid = uuidv4();
  const otp = generate_OTP();
  try {
    // Only one code may be live at a time. Without this the per-code attempt cap means nothing:
    // an attacker could request a fresh code and carry on guessing the previous one.
    await execute_value({
      text: `UPDATE ${TABLE.OTP_LOG} SET status = 'Inactive' WHERE user_id = $1 AND status = 'Active'`,
      values: [user_id],
    });

    await execute_value({
      text: `INSERT INTO ${TABLE.OTP_LOG} (oid, user_id, otp, expires_at, status) values ($1, $2, $3, $4, $5)`,
      values: [otp_oid, user_id, otp, new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000), 'Active'],
    });

    // The code is deliberately not logged. It used to be written here at info level, which handed
    // a complete account takeover to anyone who could read the application log.
    log.info(`OTP issued for user: ${user_id}`);
  } catch (e) {
    log.error(`An exception occurred while saving generated OTP: ${e.message}`);
    return null;
  }
  return { otp, otp_oid };
};

// How many codes this address has been sent recently, so sending can be throttled. That is both
// an email-cost control and what stops StockFlow being pointed at somebody as a nuisance.
const count_recent_otps = async (user_id, minutes) => {
  const sql = {
    text: `SELECT count(*)::int AS n FROM ${TABLE.OTP_LOG} WHERE user_id = $1 AND created_on > NOW() - ($2 || ' minutes')::interval`,
    values: [user_id, String(minutes)],
  };
  try {
    const rows = await get_data(sql);
    return rows[0]?.n ?? 0;
  } catch (e) {
    log.error(`An exception occurred while counting recent OTPs: ${e.message}`);
    // Fail closed: if the throttle cannot be evaluated, do not send.
    return Number.MAX_SAFE_INTEGER;
  }
};

module.exports = {
  generate_token,
  refresh_token,
  generateRandomString,
  update_login_log,
  get_access_token_from_db,
  save_generated_otp,
  count_recent_otps,
  OTP_TTL_MINUTES
};