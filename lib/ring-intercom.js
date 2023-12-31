"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RingIntercom = void 0;
const ring_types_1 = require("./ring-types");
const rest_client_1 = require("./rest-client");
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
const ring_camera_1 = require("./ring-camera");
const util_1 = require("./util");
class RingIntercom {
    constructor(initialData, restClient) {
        this.initialData = initialData;
        this.restClient = restClient;
        this.onRequestUpdate = new rxjs_1.Subject();
        this.onDing = new rxjs_1.Subject();
        this.onUnlocked = new rxjs_1.Subject();
        this.id = this.initialData.id;
        this.deviceType = this.initialData.kind;
        this.onData = new rxjs_1.BehaviorSubject(this.initialData);
        this.onBatteryLevel = this.onData.pipe((0, operators_1.map)((data) => (0, ring_camera_1.getBatteryLevel)(data)), (0, operators_1.distinctUntilChanged)());
        if (!initialData.subscribed) {
            this.subscribeToDingEvents().catch((e) => {
                (0, util_1.logError)('Failed to subscribe ' + initialData.description + ' to ding events');
                (0, util_1.logError)(e);
            });
        }
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
    get isOffline() {
        return this.data.alerts.connection === 'offline';
    }
    get batteryLevel() {
        return (0, ring_camera_1.getBatteryLevel)(this.data);
    }
    unlock() {
        return this.restClient.request({
            method: 'PUT',
            url: (0, rest_client_1.commandsApi)(`devices/${this.id}/device_rpc`),
            json: {
                command_name: 'device_rpc',
                request: {
                    jsonrpc: '2.0',
                    method: 'unlock_door',
                    params: {
                        door_id: 0,
                        user_id: 0,
                    },
                },
            },
        });
    }
    doorbotUrl(path = '') {
        return (0, rest_client_1.clientApi)(`doorbots/${this.id}/${path}`);
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
    processPushNotification(notification) {
        if (notification.action === ring_types_1.PushNotificationAction.Ding) {
            this.onDing.next();
        }
        else if (notification.action === ring_types_1.PushNotificationAction.IntercomUnlock) {
            this.onUnlocked.next();
        }
    }
}
exports.RingIntercom = RingIntercom;
