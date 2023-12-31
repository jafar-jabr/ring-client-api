"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RingRestClient = exports.appApi = exports.commandsApi = exports.deviceApi = exports.clientApi = void 0;
const got_1 = __importDefault(require("got"));
const util_1 = require("./util");
const rxjs_1 = require("rxjs");
const assert_1 = __importDefault(require("assert"));
const defaultRequestOptions = {
    responseType: 'json',
    method: 'GET',
    retry: 0,
    timeout: 20000,
}, ringErrorCodes = {
    7050: 'NO_ASSET',
    7019: 'ASSET_OFFLINE',
    7061: 'ASSET_CELL_BACKUP',
    7062: 'UPDATING',
    7063: 'MAINTENANCE',
}, clientApiBaseUrl = 'https://api.ring.com/clients_api/', deviceApiBaseUrl = 'https://api.ring.com/devices/v1/', commandsApiBaseUrl = 'https://api.ring.com/commands/v1/', appApiBaseUrl = 'https://app.ring.com/api/v1/', apiVersion = 11;
function clientApi(path) {
    return clientApiBaseUrl + path;
}
exports.clientApi = clientApi;
function deviceApi(path) {
    return deviceApiBaseUrl + path;
}
exports.deviceApi = deviceApi;
function commandsApi(path) {
    return commandsApiBaseUrl + path;
}
exports.commandsApi = commandsApi;
function appApi(path) {
    return appApiBaseUrl + path;
}
exports.appApi = appApi;
async function requestWithRetry(requestOptions) {
    try {
        const options = {
            ...defaultRequestOptions,
            ...requestOptions,
        }, { headers, body } = (await (0, got_1.default)(options)), data = body;
        if (data !== null && typeof data === 'object') {
            if (headers.date) {
                data.responseTimestamp = new Date(headers.date).getTime();
            }
            if (headers['x-time-millis']) {
                data.timeMillis = Number(headers['x-time-millis']);
            }
        }
        return data;
    }
    catch (e) {
        if (!e.response && !requestOptions.allowNoResponse) {
            (0, util_1.logError)(`Failed to reach Ring server at ${requestOptions.url}.  ${e.message}.  Trying again in 5 seconds...`);
            if (e.message.includes('NGHTTP2_ENHANCE_YOUR_CALM')) {
                (0, util_1.logError)(`There is a known issue with your current NodeJS version (${process.version}).  Please see https://github.com/dgreif/ring/wiki/NGHTTP2_ENHANCE_YOUR_CALM-Error for details`);
            }
            (0, util_1.logDebug)(e);
            await (0, util_1.delay)(5000);
            return requestWithRetry(requestOptions);
        }
        throw e;
    }
}
function parseAuthConfig(rawRefreshToken) {
    if (!rawRefreshToken) {
        return;
    }
    try {
        const config = JSON.parse((0, util_1.fromBase64)(rawRefreshToken));
        (0, assert_1.default)(config);
        (0, assert_1.default)(config.rt);
        return config;
    }
    catch (_) {
        return {
            rt: rawRefreshToken,
        };
    }
}
class RingRestClient {
    clearPreviousAuth() {
        this._authPromise = undefined;
    }
    get authPromise() {
        if (!this._authPromise) {
            const authPromise = this.getAuth();
            this._authPromise = authPromise;
            authPromise
                .then(({ expires_in }) => {
                // clear the existing auth promise 1 minute before it expires
                const timeout = setTimeout(() => {
                    if (this._authPromise === authPromise) {
                        this.clearPreviousAuth();
                    }
                }, ((expires_in || 3600) - 60) * 1000);
                this.timeouts.push(timeout);
            })
                .catch(() => {
                // ignore these errors here, they should be handled by the function making a rest request
            });
        }
        return this._authPromise;
    }
    constructor(authOptions) {
        this.authOptions = authOptions;
        this.refreshToken = 'refreshToken' in this.authOptions
            ? this.authOptions.refreshToken
            : undefined;
        this.authConfig = parseAuthConfig(this.refreshToken);
        this.hardwareIdPromise = this.authConfig?.hid || (0, util_1.getHardwareId)(this.authOptions.systemId);
        this.timeouts = [];
        this.sessionPromise = undefined;
        this.using2fa = false;
        this.onRefreshTokenUpdated = new rxjs_1.ReplaySubject(1);
        this.onSession = new rxjs_1.ReplaySubject(1);
        this.baseSessionMetadata = {
            api_version: apiVersion,
            device_model: this.authOptions.controlCenterDisplayName ?? 'ring-client-api',
        };
    }
    getGrantData(twoFactorAuthCode) {
        const { authOptions } = this;
        return {
            grant_type: 'password',
            password: authOptions.password,
            username: authOptions.email,
        };
        throw new Error('Refresh token is not valid.  Unable to authenticate with Ring servers.  See https://github.com/dgreif/ring/wiki/Refresh-Tokens');
    }
    async getAuth(twoFactorAuthCode) {
        const grantData = this.getGrantData(twoFactorAuthCode);
        try {
            const hardwareId = await this.hardwareIdPromise, response = await requestWithRetry({
                url: 'https://oauth.ring.com/oauth/token',
                json: {
                    client_id: 'ring_official_android',
                    scope: 'client',
                    ...grantData,
                },
                method: 'POST',
                headers: {
                    '2fa-support': 'true',
                    '2fa-code': this.authOptions.twoFactorAuthCode || '',
                    hardware_id: hardwareId,
                    'User-Agent': 'android:com.ringapp',
                },
            }), oldRefreshToken = this.refreshToken;
            // Store the new refresh token and auth config
            this.authConfig = {
                ...this.authConfig,
                rt: response.refresh_token,
                hid: hardwareId,
            };
            this.refreshToken = (0, util_1.toBase64)(JSON.stringify(this.authConfig));
            // Emit an event with the new token
            this.onRefreshTokenUpdated.next({
                oldRefreshToken,
                newRefreshToken: this.refreshToken,
            });
            return {
                ...response,
                // Override the refresh token in the response so that consumers of this data get the wrapped version
                refresh_token: this.refreshToken,
            };
        }
        catch (requestError) {
            if (grantData.refresh_token) {
                // failed request with refresh token
                this.refreshToken = undefined;
                this.authConfig = undefined;
                (0, util_1.logError)(requestError);
                return this.getAuth();
            }
            const response = requestError.response || {}, responseData = response.body || {}, responseError = 'error' in responseData && typeof responseData.error === 'string'
                ? responseData.error
                : '';
            if (response.statusCode === 412 || // need 2fa code
                (response.statusCode === 400 &&
                    responseError.startsWith('Verification Code')) // invalid 2fa code entered
            ) {
                this.using2fa = true;
                if (response.statusCode === 400) {
                    this.promptFor2fa = 'Invalid 2fa code entered.  Please try again.';
                    throw new Error(responseError);
                }
                if ('tsv_state' in responseData) {
                    const { tsv_state, phone } = responseData, prompt = tsv_state === 'totp'
                        ? 'from your authenticator app'
                        : `sent to ${phone} via ${tsv_state}`;
                    this.promptFor2fa = `Please enter the code ${prompt}`;
                }
                else {
                    this.promptFor2fa = 'Please enter the code sent to your text/email';
                }
                throw new Error('Your Ring account is configured to use 2-factor authentication (2fa).  See https://github.com/dgreif/ring/wiki/Refresh-Tokens for details.');
            }
            const authTypeMessage = 'refreshToken' in this.authOptions
                ? 'refresh token is'
                : 'email and password are', errorMessage = 'Failed to fetch oauth token from Ring. ' +
                ('error_description' in responseData &&
                    responseData.error_description ===
                        'too many requests from dependency service'
                    ? 'You have requested too many 2fa codes.  Ring limits 2fa to 10 codes within 10 minutes.  Please try again in 10 minutes.'
                    : `Verify that your ${authTypeMessage} correct.`) +
                ` (error: ${responseError})`;
            (0, util_1.logError)(requestError.response || requestError);
            (0, util_1.logError)(errorMessage);
            throw new Error(errorMessage);
        }
    }
    async fetchNewSession(authToken) {
        return requestWithRetry({
            url: clientApi('session'),
            json: {
                device: {
                    hardware_id: await this.hardwareIdPromise,
                    metadata: this.baseSessionMetadata,
                    os: 'android', // can use android, ios, ring-site, windows for sure
                },
            },
            method: 'POST',
            headers: {
                authorization: `Bearer ${authToken.access_token}`,
            },
        });
    }
    getSession() {
        return this.authPromise.then(async (authToken) => {
            try {
                const session = await this.fetchNewSession(authToken);
                this.onSession.next(session);
                return session;
            }
            catch (e) {
                const response = e.response || {};
                if (response.statusCode === 401) {
                    await this.refreshAuth();
                    return this.getSession();
                }
                if (response.statusCode === 429) {
                    const retryAfter = e.response.headers['retry-after'], waitSeconds = isNaN(retryAfter)
                        ? 200
                        : Number.parseInt(retryAfter, 10);
                    (0, util_1.logError)(`Session response rate limited. Waiting to retry after ${waitSeconds} seconds`);
                    await (0, util_1.delay)((waitSeconds + 1) * 1000);
                    (0, util_1.logInfo)('Retrying session request');
                    return this.getSession();
                }
                throw e;
            }
        });
    }
    async refreshAuth() {
        this.clearPreviousAuth();
        await this.authPromise;
    }
    refreshSession() {
        this.sessionPromise = this.getSession();
        this.sessionPromise
            .finally(() => {
            // Refresh the session every 12 hours
            // This is needed to keep the session alive for users outside the US, due to Data Residency laws
            // We believe Ring is clearing the session info after ~24 hours, which breaks Push Notifications
            const timeout = setTimeout(() => {
                this.refreshSession();
            }, 12 * 60 * 60 * 1000); // 12 hours
            this.timeouts.push(timeout);
        })
            .catch((e) => (0, util_1.logError)(e));
    }
    async request(options) {
        const hardwareId = await this.hardwareIdPromise, url = options.url, initialSessionPromise = this.sessionPromise;
        try {
            await initialSessionPromise;
            const authTokenResponse = await this.authPromise;
            return await requestWithRetry({
                ...options,
                headers: {
                    ...options.headers,
                    authorization: `Bearer ${authTokenResponse.access_token}`,
                    hardware_id: hardwareId,
                    'User-Agent': 'android:com.ringapp',
                },
            });
        }
        catch (e) {
            const response = e.response || {};
            if (response.statusCode === 401) {
                await this.refreshAuth();
                return this.request(options);
            }
            if (response.statusCode === 504) {
                // Gateway Timeout.  These should be recoverable, but wait a few seconds just to be on the safe side
                await (0, util_1.delay)(5000);
                return this.request(options);
            }
            if (response.statusCode === 404 &&
                response.body &&
                Array.isArray(response.body.errors)) {
                const errors = response.body.errors, errorText = errors
                    .map((code) => ringErrorCodes[code])
                    .filter((x) => x)
                    .join(', ');
                if (errorText) {
                    (0, util_1.logError)(`http request failed.  ${url} returned errors: (${errorText}).  Trying again in 20 seconds`);
                    await (0, util_1.delay)(20000);
                    return this.request(options);
                }
                (0, util_1.logError)(`http request failed.  ${url} returned unknown errors: (${(0, util_1.stringify)(errors)}).`);
            }
            if (response.statusCode === 404 && url.startsWith(clientApiBaseUrl)) {
                (0, util_1.logError)('404 from endpoint ' + url);
                if (response.body?.error?.includes(hardwareId)) {
                    (0, util_1.logError)('Session hardware_id not found.  Creating a new session and trying again.');
                    if (this.sessionPromise === initialSessionPromise) {
                        this.refreshSession();
                    }
                    return this.request(options);
                }
                throw new Error('Not found with response: ' + (0, util_1.stringify)(response.body));
            }
            if (response.statusCode) {
                (0, util_1.logError)(`Request to ${url} failed with status ${response.statusCode}. Response body: ${(0, util_1.stringify)(response.body)}`);
            }
            else if (!options.allowNoResponse) {
                (0, util_1.logError)(`Request to ${url} failed:`);
                (0, util_1.logError)(e);
            }
            throw e;
        }
    }
    getCurrentAuth() {
        return this.authPromise;
    }
    clearTimeouts() {
        this.timeouts.forEach(clearTimeout);
    }
    get _internalOnly_pushNotificationCredentials() {
        return this.authConfig?.pnc;
    }
    set _internalOnly_pushNotificationCredentials(credentials) {
        if (!this.refreshToken || !this.authConfig) {
            throw new Error('Cannot set push notification credentials without a refresh token');
        }
        const oldRefreshToken = this.refreshToken;
        this.authConfig = {
            ...this.authConfig,
            pnc: credentials,
        };
        // SOMEDAY: refactor the conversion from auth config to refresh token - DRY from above
        const newRefreshToken = (0, util_1.toBase64)(JSON.stringify(this.authConfig));
        if (newRefreshToken === oldRefreshToken) {
            // No change, so we don't need to emit an updated refresh token
            return;
        }
        // Save and emit the updated refresh token
        this.refreshToken = newRefreshToken;
        this.onRefreshTokenUpdated.next({
            oldRefreshToken,
            newRefreshToken,
        });
    }
}
exports.RingRestClient = RingRestClient;
