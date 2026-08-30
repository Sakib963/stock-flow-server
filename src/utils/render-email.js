const fs = require("fs");
const path = require("path");
const { COMPANY_INFO } = require("./company-info");

/**
 * Loads a template pair and fills in its placeholders.
 *
 * Every transactional email ships both parts. The HTML is what most people see; the plain text is
 * what a text-only client, a screen reader, and a spam filter see, and an email with no text part
 * scores worse for delivery.
 *
 * The .txt file carries its own `Subject:` and `Preheader:` header lines, which is where the
 * subject comes from. They are stripped before the rest becomes the body, so the copy lives with
 * the design rather than being duplicated in a controller.
 *
 * @param {string} dir      Folder holding `<name>.html` and `<name>.txt`
 * @param {string} name     Template basename
 * @param {object} tokens   Extra placeholder values, e.g. { OTP: '123456' }
 * @returns {{ subject: string, html: string, text: string }}
 */
const render_email = (dir, name, tokens = {}) => {
    const html_raw = fs.readFileSync(path.join(dir, `${name}.html`), "utf8");
    const text_raw = fs.readFileSync(path.join(dir, `${name}.txt`), "utf8");

    const all = {
        APP_NAME: COMPANY_INFO.appName,
        SUPPORT_EMAIL: COMPANY_INFO.supportEmail,
        HELP_CENTER_URL: COMPANY_INFO.helpCenterUrl,
        LOGO_URL: COMPANY_INFO.publicLogoUrl,
        YEAR: String(new Date().getFullYear()),
        ...tokens,
    };

    const fill = (source) => Object.entries(all).reduce((out, [key, value]) => out.split(`{{${key}}}`).join(String(value ?? "")), source);

    const text_filled = fill(text_raw);
    const subject_line = text_filled.split(/\r?\n/).find((l) => l.startsWith("Subject:"));

    // Drop the Subject and Preheader header lines, and any blank lines they leave behind.
    const body = text_filled
        .split(/\r?\n/)
        .filter((l) => !l.startsWith("Subject:") && !l.startsWith("Preheader:"))
        .join("\n")
        .replace(/^\s+/, "");

    return {
        subject: subject_line ? subject_line.replace("Subject:", "").trim() : COMPANY_INFO.appName,
        html: fill(html_raw),
        text: body,
    };
};

module.exports = { render_email };
