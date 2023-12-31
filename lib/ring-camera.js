"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RingCamera = exports.cleanSnapshotUuid = exports.getSearchQueryString = exports.getBatteryLevel = void 0;
const ring_types_1 = require("./ring-types");
const rest_client_1 = require("./rest-client");
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
const util_1 = require("./util");
const subscribed_1 = require("./subscribed");
const webrtc_connection_1 = require("./streaming/webrtc-connection");
const streaming_session_1 = require("./streaming/streaming-session");
const simple_webrtc_session_1 = require("./streaming/simple-webrtc-session");
const maxSnapshotRefreshSeconds = 15, fullDayMs = 24 * 60 * 60 * 1000;
function parseBatteryLife(batteryLife) {
    if (batteryLife === null || batteryLife === undefined) {
        return null;
    }
    const batteryLevel = typeof batteryLife === 'number'
        ? batteryLife
        : Number.parseFloat(batteryLife);
    if (isNaN(batteryLevel)) {
        return null;
    }
    return batteryLevel;
}
function getStartOfToday() {
    return new Date(new Date().toLocaleDateString()).getTime();
}
function getEndOfToday() {
    return getStartOfToday() + fullDayMs - 1;
}
function getBatteryLevel(data) {
    const levels = [
        parseBatteryLife(data.battery_life),
        parseBatteryLife(data.battery_life_2),
    ].filter((level) => level !== null), { health } = data;
    if (!levels.length ||
        (health && !health.battery_percentage && !health.battery_present)) {
        return null;
    }
    return Math.min(...levels);
}
exports.getBatteryLevel = getBatteryLevel;
function getSearchQueryString(options) {
    const queryString = Object.entries(options)
        .map(([key, value]) => {
        if (value === undefined) {
            return '';
        }
        if (key === 'olderThanId') {
            key = 'pagination_key';
        }
        return `${key}=${value}`;
    })
        .filter((x) => x)
        .join('&');
    return queryString.length ? `?${queryString}` : '';
}
exports.getSearchQueryString = getSearchQueryString;
function cleanSnapshotUuid(uuid) {
    if (!uuid) {
        return uuid;
    }
    return uuid.replace(/:.*$/, '');
}
exports.cleanSnapshotUuid = cleanSnapshotUuid;
class RingCamera extends subscribed_1.Subscribed {
    constructor(initialData, isDoorbot, restClient, avoidSnapshotBatteryDrain) {
        super();
        this.initialData = initialData;
        this.isDoorbot = isDoorbot;
        this.restClient = restClient;
        this.avoidSnapshotBatteryDrain = avoidSnapshotBatteryDrain;
        this.onRequestUpdate = new rxjs_1.Subject();
        this.onNewNotification = new rxjs_1.Subject();
        this.onActiveNotifications = new rxjs_1.BehaviorSubject([]);
        this.onDoorbellPressed = this.onNewNotification.pipe((0, operators_1.filter)((notification) => notification.action === ring_types_1.PushNotificationAction.Ding), (0, operators_1.share)());
        this.onMotionDetected = this.onActiveNotifications.pipe((0, operators_1.map)((notifications) => notifications.some((notification) => notification.action === ring_types_1.PushNotificationAction.Motion)), (0, operators_1.distinctUntilChanged)(), (0, operators_1.publishReplay)(1), (0, operators_1.refCount)());
        this.onMotionStarted = this.onMotionDetected.pipe((0, operators_1.filter)((currentlyDetected) => currentlyDetected), (0, operators_1.mapTo)(null), // no value needed, event is what matters
        (0, operators_1.share)());
        this.lastSnapshotTimestamp = 0;
        this.lastSnapshotTimestampLocal = 0;
        this.fetchingSnapshot = false;
        this.id = this.initialData.id;
        this.deviceType = this.initialData.kind;
        this.model =
            ring_types_1.RingCameraModel[this.initialData.kind] ||
                'Unknown Model';
        this.onData = new rxjs_1.BehaviorSubject(this.initialData);
        this.hasLight = this.initialData.led_status !== undefined;
        this.hasSiren = this.initialData.siren_status !== undefined;
        this.onBatteryLevel = this.onData.pipe((0, operators_1.map)((data) => {
            if (!('battery_life' in data)) {
                return null;
            }
            return getBatteryLevel(data);
        }), (0, operators_1.distinctUntilChanged)());
        this.onInHomeDoorbellStatus = this.onData.pipe((0, operators_1.map)(({ settings: { chime_settings } }) => {
            return Boolean(chime_settings?.enable);
        }), (0, operators_1.distinctUntilChanged)());
        this.addSubscriptions(this.restClient.onSession
            .pipe((0, operators_1.startWith)(undefined), (0, operators_1.throttleTime)(1000)) // Force this to run immediately, but don't double run if a session is created due to these api calls
            .subscribe(() => {
            this.subscribeToDingEvents().catch((e) => {
                (0, util_1.logError)('Failed to subscribe ' +
                    initialData.description +
                    ' to ding events');
                (0, util_1.logError)(e);
            });
            this.subscribeToMotionEvents().catch((e) => {
                (0, util_1.logError)('Failed to subscribe ' +
                    initialData.description +
                    ' to motion events');
                (0, util_1.logError)(e);
            });
        }));
    }
    updateData(update) {
        this.onData.next(update);
    }
    requestUpdate() {
        this.onRequestUpdate.next(null);
    }
    get data() {
        return this.onData.getValue();
    }
    get name() {
        return this.data.description;
    }
    get activeNotifications() {
        return this.onActiveNotifications.getValue();
    }
    get latestNotification() {
        const notifications = this.activeNotifications;
        return notifications[notifications.length - 1];
    }
    get latestNotificationSnapshotUuid() {
        const notification = this.latestNotification;
        return notification?.ding.image_uuid;
    }
    get batteryLevel() {
        if (!('battery_life' in this.data)) {
            return null;
        }
        return getBatteryLevel(this.data);
    }
    get hasBattery() {
        return this.batteryLevel !== null;
    }
    get hasLowBattery() {
        return this.data.alerts.battery === 'low';
    }
    get isCharging() {
        if (!('external_connection' in this.data)) {
            return false;
        }
        return this.data.external_connection;
    }
    get operatingOnBattery() {
        return this.hasBattery && this.data.settings.power_mode !== 'wired';
    }
    get isOffline() {
        return this.data.alerts.connection === 'offline';
    }
    get isRingEdgeEnabled() {
        return this.data.settings.sheila_settings.local_storage_enabled === true;
    }
    get hasInHomeDoorbell() {
        const { chime_settings } = this.data.settings;
        return (this.isDoorbot &&
            Boolean(chime_settings &&
                [ring_types_1.DoorbellType.Mechanical, ring_types_1.DoorbellType.Digital].includes(chime_settings.type)));
    }
    doorbotUrl(path = '') {
        return (0, rest_client_1.clientApi)(`doorbots/${this.id}/${path}`);
    }
    deviceUrl(path = '') {
        return (0, rest_client_1.deviceApi)(`devices/${this.id}/${path}`);
    }
    async setLight(on) {
        if (!this.hasLight) {
            return false;
        }
        const state = on ? 'on' : 'off';
        await this.restClient.request({
            method: 'PUT',
            url: this.doorbotUrl('floodlight_light_' + state),
        });
        this.updateData({ ...this.data, led_status: state });
        return true;
    }
    async setSiren(on) {
        if (!this.hasSiren) {
            return false;
        }
        await this.restClient.request({
            method: 'PUT',
            url: this.doorbotUrl('siren_' + (on ? 'on' : 'off')),
        });
        const seconds = on ? 1 : 0;
        this.updateData({
            ...this.data,
            siren_status: { seconds_remaining: seconds },
        });
        return true;
    }
    async setSettings(settings) {
        await this.restClient.request({
            method: 'PUT',
            url: this.doorbotUrl(),
            json: { doorbot: { settings } },
        });
        this.requestUpdate();
    }
    async setDeviceSettings(settings) {
        const response = await this.restClient.request({
            method: 'PATCH',
            url: this.deviceUrl('settings'),
            json: settings,
        });
        this.requestUpdate();
        return response;
    }
    getDeviceSettings() {
        return this.restClient.request({
            method: 'GET',
            url: this.deviceUrl('settings'),
        });
    }
    // Enable or disable the in-home doorbell (if digital or mechanical)
    async setInHomeDoorbell(enable) {
        if (!this.hasInHomeDoorbell) {
            return false;
        }
        await this.setSettings({ chime_settings: { enable } });
        return true;
    }
    async getHealth() {
        const response = await this.restClient.request({
            url: this.doorbotUrl('health'),
        });
        return response.device_health;
    }
    async createStreamingConnection(options) {
        const response = await this.restClient
            .request({
            method: 'POST',
            url: (0, rest_client_1.appApi)('clap/ticket/request/signalsocket'),
        })
            .catch((e) => {
            throw e;
        });
        return new webrtc_connection_1.WebrtcConnection(response.ticket, this, options);
    }
    async startLiveCall(options = {}) {
        const connection = await this.createStreamingConnection(options);
        return new streaming_session_1.StreamingSession(this, connection);
    }
    removeDingById(idToRemove) {
        const allActiveDings = this.activeNotifications, otherDings = allActiveDings.filter(({ ding }) => ding.id !== idToRemove);
        this.onActiveNotifications.next(otherDings);
    }
    processPushNotification(notification) {
        if (!('ding' in notification)) {
            // only process ding/motion notifications
            return;
        }
        const activeDings = this.activeNotifications, dingId = notification.ding.id;
        this.onActiveNotifications.next(activeDings.filter((d) => d.ding.id !== dingId).concat([notification]));
        this.onNewNotification.next(notification);
        setTimeout(() => {
            this.removeDingById(dingId);
        }, 65 * 1000); // dings last ~1 minute
    }
    getEvents(options = {}) {
        return this.restClient.request({
            url: (0, rest_client_1.clientApi)(`locations/${this.data.location_id}/devices/${this.id}/events${getSearchQueryString(options)}`),
        });
    }
    videoSearch({ dateFrom, dateTo, order = 'asc' } = {
        dateFrom: getStartOfToday(),
        dateTo: getEndOfToday(),
    }) {
        return this.restClient.request({
            url: (0, rest_client_1.clientApi)(`video_search/history?doorbot_id=${this.id}&date_from=${dateFrom}&date_to=${dateTo}&order=${order}&api_version=11&includes%5B%5D=pva`),
        });
    }
    getPeriodicalFootage({ startAtMs, endAtMs } = {
        startAtMs: getStartOfToday(),
        endAtMs: getEndOfToday(),
    }) {
        // These will be mp4 clips that are created using periodic snapshots
        return this.restClient.request({
            url: `https://api.ring.com/recordings/public/footages/${this.id}?start_at_ms=${startAtMs}&end_at_ms=${endAtMs}&kinds=online_periodical&kinds=offline_periodical`,
        });
    }
    async getRecordingUrl(dingIdStr, { transcoded = false } = {}) {
        const path = transcoded ? 'recording' : 'share/play', response = await this.restClient.request({
            url: (0, rest_client_1.clientApi)(`dings/${dingIdStr}/${path}?disable_redirect=true`),
        });
        return response.url;
    }
    isTimestampInLifeTime(timestampAge) {
        return timestampAge < this.snapshotLifeTime;
    }
    get snapshotsAreBlocked() {
        return this.data.settings.motion_detection_enabled === false;
    }
    get snapshotLifeTime() {
        return this.avoidSnapshotBatteryDrain && this.operatingOnBattery
            ? 600 * 1000 // battery cams only refresh timestamp every 10 minutes
            : 10 * 1000; // snapshot updates will be forced.  Limit to 10s lifetime
    }
    get currentTimestampAge() {
        return Date.now() - this.lastSnapshotTimestampLocal;
    }
    get hasSnapshotWithinLifetime() {
        return this.isTimestampInLifeTime(this.currentTimestampAge);
    }
    checkIfSnapshotsAreBlocked() {
        if (this.snapshotsAreBlocked) {
            throw new Error(`Motion detection is disabled for ${this.name}, which prevents snapshots from this camera.  This can be caused by Modes settings or by turning off the Record Motion setting.`);
        }
        if (this.isOffline) {
            throw new Error(`Cannot fetch snapshot for ${this.name} because it is offline`);
        }
    }
    shouldUseExistingSnapshotPromise() {
        if (this.fetchingSnapshot) {
            return true;
        }
        if (this.hasSnapshotWithinLifetime) {
            (0, util_1.logDebug)(`Snapshot for ${this.name} is still within its life time (${this.currentTimestampAge / 1000}s old)`);
            return true;
        }
        if (!this.avoidSnapshotBatteryDrain || !this.operatingOnBattery) {
            // tell the camera to update snapshot immediately.
            // avoidSnapshotBatteryDrain is best if you have a battery cam that you request snapshots for frequently.  This can lead to battery drain if snapshot updates are forced.
            return false;
        }
    }
    async getSnapshot({ uuid } = {}) {
        if (this.lastSnapshotPromise && this.shouldUseExistingSnapshotPromise()) {
            return this.lastSnapshotPromise;
        }
        this.checkIfSnapshotsAreBlocked();
        this.lastSnapshotPromise = Promise.race([
            this.getNextSnapshot(uuid
                ? { uuid }
                : {
                    afterMs: this.lastSnapshotTimestamp,
                    force: true,
                }),
            (0, util_1.delay)(maxSnapshotRefreshSeconds * 1000).then(() => {
                const extraMessageForBatteryCam = this.operatingOnBattery
                    ? '.  This is normal behavior since this camera is unable to capture snapshots while streaming'
                    : '';
                throw new Error(`Snapshot for ${this.name} (${this.deviceType} - ${this.model}) failed to refresh after ${maxSnapshotRefreshSeconds} seconds${extraMessageForBatteryCam}`);
            }),
        ]);
        try {
            await this.lastSnapshotPromise;
        }
        catch (e) {
            // snapshot request failed, don't use it again
            this.lastSnapshotPromise = undefined;
            throw e;
        }
        this.fetchingSnapshot = false;
        return this.lastSnapshotPromise;
    }
    async getNextSnapshot({ afterMs, maxWaitMs, force, uuid, }) {
        const response = await this.restClient.request({
            url: `https://app-snaps.ring.com/snapshots/next/${this.id}`,
            responseType: 'buffer',
            searchParams: {
                'after-ms': afterMs,
                'max-wait-ms': maxWaitMs,
                extras: force ? 'force' : undefined,
                uuid: cleanSnapshotUuid(uuid),
            },
            headers: {
                accept: 'image/jpeg',
            },
            allowNoResponse: true,
        }), { responseTimestamp, timeMillis } = response, timestampAge = Math.abs(responseTimestamp - timeMillis);
        this.lastSnapshotTimestamp = timeMillis;
        this.lastSnapshotTimestampLocal = Date.now() - timestampAge;
        return response;
    }
    getSnapshotByUuid(uuid) {
        return this.restClient.request({
            url: (0, rest_client_1.clientApi)('snapshots/uuid?uuid=' + cleanSnapshotUuid(uuid)),
            responseType: 'buffer',
            headers: {
                accept: 'image/jpeg',
            },
        });
    }
    async recordToFile(outputPath, duration = 30) {
        const liveCall = await this.streamVideo({
            output: ['-t', duration.toString(), outputPath],
        });
        await (0, rxjs_1.firstValueFrom)(liveCall.onCallEnded);
    }
    async streamVideo(ffmpegOptions) {
        const liveCall = await this.startLiveCall();
        await liveCall.startTranscoding(ffmpegOptions);
        return liveCall;
    }
    /**
     * Returns a SimpleWebRtcSession, which can be initiated with an sdp offer.
     * This session has no backplane for trickle ICE, and is designed for use in a
     * browser setting.  Note, cameras with Ring Edge enabled will stream with the speaker
     * enabled as soon as the stream starts, which can drain the battery more quickly.
     */
    createSimpleWebRtcSession() {
        return new simple_webrtc_session_1.SimpleWebRtcSession(this, this.restClient);
    }
    subscribeToDingEvents() {
        return this.restClient.request({
            method: 'POST',
            url: this.doorbotUrl('subscribe'),
        });
    }
    unsubscribeFromDingEvents() {
        return this.restClient.request({
            method: 'POST',
            url: this.doorbotUrl('unsubscribe'),
        });
    }
    subscribeToMotionEvents() {
        return this.restClient.request({
            method: 'POST',
            url: this.doorbotUrl('motions_subscribe'),
        });
    }
    unsubscribeFromMotionEvents() {
        return this.restClient.request({
            method: 'POST',
            url: this.doorbotUrl('motions_unsubscribe'),
        });
    }
    disconnect() {
        this.unsubscribe();
    }
}
exports.RingCamera = RingCamera;
