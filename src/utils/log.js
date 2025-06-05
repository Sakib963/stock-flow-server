require("winston-daily-rotate-file");
const path = require("path");
const winston = require("winston");

const isFileLoggingEnabled = false;
const PROJECT_ROOT = path.join(__dirname, "..");
const transports = [];

// Common log format
const commonFormat = winston.format.combine(
      winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
      winston.format.simple(),
      winston.format.printf((info) => {
            return `${info.timestamp} ${info.level.toUpperCase()} - ${info.message} `;
      }),
      winston.format.colorize({ all: false })
);

// Console log transport
const console_log = new winston.transports.Console({
      level: "debug",
      format: winston.format.combine(
            winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
            winston.format.simple(),
            winston.format.printf((info) => {
                  return `${info.timestamp} ${info.level.toUpperCase()} - ${info.message} `;
            }),
            winston.format.colorize({ all: true })
      ),
});

// File-based logs (conditionally added)
if (isFileLoggingEnabled) {
      const info_file_log = new winston.transports.DailyRotateFile({
            filename: `log/info/stockflow_server__%DATE%.log`,
            datePattern: "YYYY-MM-DD",
            zippedArchive: true,
            level: "info",
            format: commonFormat,
      });

      const debug_file_log = new winston.transports.DailyRotateFile({
            filename: `log/debug/stockflow_server__%DATE%.log`,
            datePattern: "YYYY-MM-DD",
            zippedArchive: true,
            level: "debug",
            format: commonFormat,
      });

      transports.push(info_file_log, debug_file_log);
}

// Add console transport unconditionally
transports.push(console_log);

// Logger instance
const log = new winston.createLogger({
      level: "debug",
      transports,
});

// Log stream for external integrations
log.stream = {
      write: function (message) {
            log.info(message.trim());
      },
};

// Log helper functions
module.exports.debug = module.exports.log = function () {
      log.debug.apply(log, formatLogArguments(arguments));
};

module.exports.info = function () {
      log.info.apply(log, formatLogArguments(arguments));
};

module.exports.warn = function () {
      log.warn.apply(log, formatLogArguments(arguments));
};

module.exports.error = function () {
      log.error.apply(log, formatLogArguments(arguments));
};

module.exports.stream = log.stream;

// Utility functions for stack trace
function formatLogArguments(args) {
      args = Array.prototype.slice.call(args);
      const stackInfo = getStackInfo(1);
      if (stackInfo) {
            const calleeStr = `${stackInfo.relativePath}:${stackInfo.line}`;
            if (typeof args[0] === "string") {
                  args[0] = `${calleeStr} - ${args[0]}`;
            } else {
                  args.unshift(calleeStr);
            }
      }
      return args;
}

function getStackInfo(stackIndex) {
      const stacklist = new Error().stack.split("\n").slice(3);
      const stackReg = /at\s+(.*)\s+\((.*):(\d*):(\d*)\)/gi;
      const stackReg2 = /at\s+()(.*):(\d*):(\d*)/gi;

      const s = stacklist[stackIndex] || stacklist[0];
      const sp = stackReg.exec(s) || stackReg2.exec(s);

      if (sp && sp.length === 5) {
            return {
                  method: sp[1],
                  relativePath: path.relative(PROJECT_ROOT, sp[2]),
                  line: sp[3],
                  pos: sp[4],
                  file: path.basename(sp[2]),
                  stack: stacklist.join("\n"),
            };
      }
}

module.exports.log = log;
