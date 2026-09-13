// Turns a user agent into the words a person recognises their own device by: "Chrome on Windows",
// a phone, a tablet.
//
// A heuristic on purpose. A full parser is a dependency bought for a label, and a wrong guess here
// costs nothing worse than a less specific name. Order matters in both lists: Edge, Opera and
// Samsung Internet all claim to be Chrome, Chrome claims to be Safari, Android claims to be Linux,
// and an iPhone claims to be "like Mac OS X".

const BROWSERS = [
    ["Edge", /Edg(e|A|iOS)?\//],
    ["Opera", /OPR\/|Opera/],
    ["Samsung Internet", /SamsungBrowser\//],
    ["Firefox", /Firefox\/|FxiOS\//],
    ["Chrome", /Chrome\/|CriOS\//],
    ["Safari", /Version\/[\d.]+.*Safari\//],
];

const SYSTEMS = [
    ["Windows", /Windows NT/],
    ["Android", /Android/],
    ["iOS", /iPhone|iPad|iPod/],
    ["ChromeOS", /CrOS/],
    ["macOS", /Macintosh|Mac OS X/],
    ["Linux", /Linux/],
];

const pick = (list, agent) => list.find(([, pattern]) => pattern.test(agent))?.[0] ?? null;

const device_type = (agent) => {
    if (/iPad|Tablet/i.test(agent) || (/Android/.test(agent) && !/Mobile/.test(agent))) return "tablet";
    if (/Mobi|iPhone|iPod/.test(agent)) return "phone";
    return "desktop";
};

/** @returns {{ browser: string|null, os: string|null, type: 'desktop'|'phone'|'tablet' }} */
const describe_device = (user_agent) => {
    const agent = String(user_agent ?? "");
    return { browser: pick(BROWSERS, agent), os: pick(SYSTEMS, agent), type: device_type(agent) };
};

module.exports = { describe_device };
