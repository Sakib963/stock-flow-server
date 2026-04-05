const nodemailer = require("nodemailer");
const { COMPANY_INFO } = require("./company-info");

// Create reusable transporter object using Gmail
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.AUTOMATION_EMAIL,
    pass: process.env.AUTOMATION_EMAIL_PASSWORD,
  },
});

/**
 * Send Email Function
 * @param {Object} options
 * @param {string|string[]} options.to - Recipient(s) email
 * @param {string|string[]} [options.cc] - CC email(s)
 * @param {string|string[]} [options.bcc] - BCC email(s)
 * @param {string} options.subject - Email subject
 * @param {string} [options.text] - Plain text body
 * @param {string} [options.html] - HTML body
 * @param {Array} [options.attachments] - Attachments array [{ filename, path }]
 */
async function send_email(options) {
  try {
    // Normalize recipients
    const mailOptions = {
      from: `"${COMPANY_INFO.appName}" <${process.env.AUTOMATION_EMAIL}>`,
      to: Array.isArray(options.to) ? options.to.join(", ") : options.to,
      cc: options.cc
        ? Array.isArray(options.cc)
          ? options.cc.join(", ")
          : options.cc
        : undefined,
      bcc: options.bcc
        ? Array.isArray(options.bcc)
          ? options.bcc.join(", ")
          : options.bcc
        : undefined,
      subject: options.subject,
      text: options.text || undefined,
      html: options.html || undefined,
      attachments: options.attachments || undefined,
    };

    let info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`❌ Error sending email: ${error.message}`);
    return { success: false, error: error.message };
  }
}

module.exports = send_email;
