"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logRefreshToken = exports.acquireRefreshToken = void 0;
/* eslint-disable no-console */
const rest_client_1 = require("./rest-client");
const util_1 = require("./util");
async function acquireRefreshToken() {
    const email = await (0, util_1.requestInput)('Email: '), password = await (0, util_1.requestInput)('Password: '), restClient = new rest_client_1.RingRestClient({ email, password }), getAuthWith2fa = async () => {
        const code = await (0, util_1.requestInput)('2fa Code: ');
        try {
            return await restClient.getAuth(code);
        }
        catch (_) {
            console.log('Incorrect 2fa code. Please try again.');
            return getAuthWith2fa();
        }
    }, auth = await restClient.getCurrentAuth().catch((e) => {
        if (restClient.promptFor2fa) {
            console.log(restClient.promptFor2fa);
            return getAuthWith2fa();
        }
        console.error(e);
        process.exit(1);
    });
    return auth.refresh_token;
}
exports.acquireRefreshToken = acquireRefreshToken;
async function logRefreshToken() {
    console.log('This CLI will provide you with a refresh token which you can use to configure ring-client-api and homebridge-ring.');
    const refreshToken = await acquireRefreshToken();
    console.log('\nSuccessfully logged in to Ring. Please add the following to your config:\n');
    console.log(`"refreshToken": "${refreshToken}"`);
}
exports.logRefreshToken = logRefreshToken;
// eslint-disable-next-line @typescript-eslint/no-empty-function
process.on('unhandledRejection', () => { });
