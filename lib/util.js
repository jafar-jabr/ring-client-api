"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.toBase64 = exports.fromBase64 = exports.randomString = exports.randomInteger = exports.mapAsync = exports.stringify = exports.requestInput = exports.getHardwareId = exports.generateUuid = exports.enableDebug = exports.useLogger = exports.logError = exports.logInfo = exports.logDebug = exports.delay = exports.clearTimeouts = void 0;
const debug_1 = __importDefault(require("debug"));
const colors_1 = require("colors");
const readline_1 = require("readline");
const uuid_1 = require("uuid");
const systeminformation_1 = require("systeminformation");
const logger_1 = __importDefault(require("@eneris/push-receiver/dist/utils/logger"));
const debugLogger = (0, debug_1.default)('ring'), uuidNamespace = 'e53ffdc0-e91d-4ce1-bec2-df939d94739d';
let logger = {
    logInfo(message) {
        debugLogger(message);
    },
    logError(message) {
        debugLogger((0, colors_1.red)(message));
    },
}, debugEnabled = false;
const timeouts = new Set();
function clearTimeouts() {
    timeouts.forEach((timeout) => {
        clearTimeout(timeout);
    });
}
exports.clearTimeouts = clearTimeouts;
function delay(milliseconds) {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            timeouts.delete(timeout);
            resolve(undefined);
        }, milliseconds);
        timeouts.add(timeout);
    });
}
exports.delay = delay;
function logDebug(message) {
    if (debugEnabled) {
        logger.logInfo(message);
    }
}
exports.logDebug = logDebug;
function logInfo(...message) {
    logger.logInfo(...message);
}
exports.logInfo = logInfo;
function logError(message) {
    logger.logError(message);
}
exports.logError = logError;
function useLogger(newLogger) {
    logger = newLogger;
}
exports.useLogger = useLogger;
function enableDebug() {
    debugEnabled = true;
}
exports.enableDebug = enableDebug;
function generateUuid(seed) {
    if (seed) {
        return (0, uuid_1.v5)(seed, uuidNamespace);
    }
    return (0, uuid_1.v4)();
}
exports.generateUuid = generateUuid;
async function getHardwareId(systemId) {
    if (systemId) {
        return generateUuid(systemId);
    }
    const timeoutValue = '-1', { os: id } = await Promise.race([
        (0, systeminformation_1.uuid)(),
        delay(5000).then(() => ({ os: timeoutValue })),
    ]);
    if (id === timeoutValue) {
        logError('Request for system uuid timed out.  Falling back to random session id');
        return (0, uuid_1.v4)();
    }
    if (id === '-') {
        // default value set by systeminformation if it can't find a real value
        logError('Unable to get system uuid.  Falling back to random session id');
        return (0, uuid_1.v4)();
    }
    return generateUuid(id);
}
exports.getHardwareId = getHardwareId;
async function requestInput(question) {
    const lineReader = (0, readline_1.createInterface)({
        input: process.stdin,
        output: process.stdout,
    }), answer = await new Promise((resolve) => {
        lineReader.question(question, resolve);
    });
    lineReader.close();
    return answer.trim();
}
exports.requestInput = requestInput;
function stringify(data) {
    if (typeof data === 'string') {
        return data;
    }
    if (typeof data === 'object' && Buffer.isBuffer(data)) {
        return data.toString();
    }
    return JSON.stringify(data) + '';
}
exports.stringify = stringify;
function mapAsync(records, asyncMapper) {
    return Promise.all(records.map((record) => asyncMapper(record)));
}
exports.mapAsync = mapAsync;
function randomInteger() {
    return Math.floor(Math.random() * 99999999) + 100000;
}
exports.randomInteger = randomInteger;
function randomString(length) {
    const uuid = generateUuid();
    return uuid.replace(/-/g, '').substring(0, length).toLowerCase();
}
exports.randomString = randomString;
// Override push receiver logging to avoid ECONNRESET errors leaking
function logPushReceiver(...args) {
    try {
        if (args[0].toString().includes('ECONNRESET')) {
            // don't log ECONNRESET errors
            return;
        }
    }
    catch (_) {
        // proceed to log error
    }
    logDebug('[Push Receiver]');
    logDebug(args[0]);
}
logger_1.default.error = logPushReceiver;
function fromBase64(encodedInput) {
    const buff = Buffer.from(encodedInput, 'base64');
    return buff.toString('ascii');
}
exports.fromBase64 = fromBase64;
function toBase64(input) {
    const buff = Buffer.from(input);
    return buff.toString('base64');
}
exports.toBase64 = toBase64;
