const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { describe_device } = require("../../src/utils/user-agent");

// Real user agents. The traps are that Edge, Opera and Samsung Internet all say Chrome, Chrome says
// Safari, Android says Linux, and an iPhone says "like Mac OS X".
const CASES = [
    ["Chrome on Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36", { browser: "Chrome", os: "Windows", type: "desktop" }],
    ["Edge on Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0", { browser: "Edge", os: "Windows", type: "desktop" }],
    ["Opera on Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 OPR/113.0.0.0", { browser: "Opera", os: "Windows", type: "desktop" }],
    ["Safari on an iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", { browser: "Safari", os: "iOS", type: "phone" }],
    ["Chrome on an iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1", { browser: "Chrome", os: "iOS", type: "phone" }],
    ["Safari on an iPad", "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", { browser: "Safari", os: "iOS", type: "tablet" }],
    ["Chrome on an Android phone", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36", { browser: "Chrome", os: "Android", type: "phone" }],
    ["Samsung Internet on an Android tablet", "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Safari/537.36", { browser: "Samsung Internet", os: "Android", type: "tablet" }],
    ["Safari on a Mac", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", { browser: "Safari", os: "macOS", type: "desktop" }],
    ["Firefox on Linux", "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0", { browser: "Firefox", os: "Linux", type: "desktop" }],
    ["nothing at all", undefined, { browser: null, os: null, type: "desktop" }],
];

describe("describe_device", () => {
    for (const [name, agent, expected] of CASES) {
        it(`recognises ${name}`, () => {
            assert.deepEqual(describe_device(agent), expected);
        });
    }
});
