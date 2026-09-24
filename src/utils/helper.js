const { TABLE } = require("./constant");
const { v4: uuidv4 } = require('uuid');
const { log } = require("./log");
const { execute_value, get_data } = require("../db/database");
const crypto = require("crypto");

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
  generateRandomString,
  save_generated_otp,
  count_recent_otps,
  OTP_TTL_MINUTES
};
