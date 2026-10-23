const net = require("net");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const PG_BIN = "C:\\Users\\user\\postgres16\\pgsql\\bin\\pg_ctl.exe";
const PG_DATA = "C:\\Users\\user\\postgres16\\data";
const PG_LOG = "C:\\Users\\user\\postgres16\\server.log";
const PORT = 5433;
const HOST = "127.0.0.1";

function isPortOpen(port, host, timeoutMs = 1000) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(timeoutMs);
        socket.once("connect", () => {
            socket.destroy();
            resolve(true);
        });
        socket.once("timeout", () => {
            socket.destroy();
            resolve(false);
        });
        socket.once("error", () => {
            resolve(false);
        });
        socket.connect(port, host);
    });
}

function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function cleanStalePid() {
    const pidFile = path.join(PG_DATA, "postmaster.pid");
    if (fs.existsSync(pidFile)) {
        try {
            const content = fs.readFileSync(pidFile, "utf8");
            const firstLine = content.split("\n")[0].trim();
            const pid = parseInt(firstLine, 10);
            if (pid && !isProcessAlive(pid)) {
                console.log(`Cleaning up stale postmaster.pid (PID ${pid} is not running)...`);
                fs.unlinkSync(pidFile);
            }
        } catch {
            // ignore
        }
    }
}

async function startPostgres() {
    console.log(`Starting local PostgreSQL 16 on port ${PORT}...`);
    cleanStalePid();

    if (!fs.existsSync(PG_BIN)) {
        throw new Error(`pg_ctl not found at "${PG_BIN}". Please ensure Postgres is installed as described in test/README.md.`);
    }

    const child = spawn(
        PG_BIN,
        ["start", "-D", PG_DATA, "-l", PG_LOG, "-o", `"-p ${PORT} -c listen_addresses=localhost"`],
        { detached: true, stdio: "ignore", windowsHide: true }
    );
    child.unref();

    // Wait up to 20 seconds for Postgres to become ready
    const start = Date.now();
    while (Date.now() - start < 20000) {
        await new Promise((r) => setTimeout(r, 600));
        if (await isPortOpen(PORT, HOST)) {
            console.log(`PostgreSQL 16 is ready and listening on port ${PORT}.`);
            return;
        }
    }
    throw new Error(`PostgreSQL failed to respond on port ${PORT} within 20 seconds. Check logs at ${PG_LOG}.`);
}

async function main() {
    const running = await isPortOpen(PORT, HOST);
    if (running) {
        console.log(`Local PostgreSQL is already running on port ${PORT}.`);
    } else {
        await startPostgres();
    }

    const envLocalPath = path.resolve(__dirname, "../src/env/.env.local");
    console.log(`Starting StockFlow server with local env: ${envLocalPath}`);

    const env = {
        ...process.env,
        ENV_FILE: envLocalPath,
    };

    const serverProcess = spawn("nodemon", ["./server.js"], {
        cwd: path.resolve(__dirname, ".."),
        env,
        stdio: "inherit",
        shell: true,
    });

    serverProcess.on("error", (err) => {
        if (err.code === "ENOENT") {
            console.warn("nodemon not found in PATH, falling back to node ./server.js");
            const fallback = spawn("node", ["./server.js"], {
                cwd: path.resolve(__dirname, ".."),
                env,
                stdio: "inherit",
                shell: true,
            });
            fallback.on("exit", (code) => process.exit(code || 0));
        } else {
            console.error("Failed to run server:", err);
            process.exit(1);
        }
    });

    serverProcess.on("exit", (code) => {
        process.exit(code || 0);
    });
}

main().catch((err) => {
    console.error("Error launching local service:", err.message);
    process.exit(1);
});

