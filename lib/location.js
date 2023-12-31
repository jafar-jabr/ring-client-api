"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Location = void 0;
const socket_io_client_1 = require("socket.io-client");
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
const util_1 = require("./util");
const ring_types_1 = require("./ring-types");
const rest_client_1 = require("./rest-client");
const ring_camera_1 = require("./ring-camera");
const ring_device_1 = require("./ring-device");
const subscribed_1 = require("./subscribed");
const deviceListMessageType = 'DeviceInfoDocGetList';
function flattenDeviceData(data) {
    return Object.assign({}, data.general && data.general.v2, data.device && data.device.v1);
}
class Location extends subscribed_1.Subscribed {
    constructor(locationDetails, cameras, chimes, intercoms, options, restClient) {
        super();
        this.locationDetails = locationDetails;
        this.cameras = cameras;
        this.chimes = chimes;
        this.intercoms = intercoms;
        this.options = options;
        this.restClient = restClient;
        this.seq = 1;
        this.onMessage = new rxjs_1.Subject();
        this.onDataUpdate = new rxjs_1.Subject();
        this.onDeviceDataUpdate = this.onDataUpdate.pipe((0, operators_1.filter)((message) => {
            return message.datatype === 'DeviceInfoDocType' && Boolean(message.body);
        }), (0, operators_1.concatMap)((message) => message.body), (0, operators_1.map)(flattenDeviceData));
        this.onDeviceList = this.onMessage.pipe((0, operators_1.filter)((m) => m.msg === deviceListMessageType));
        this.onDevices = this.onDeviceList.pipe((0, operators_1.scan)((devices, { body: deviceList, src }) => {
            if (!deviceList) {
                return devices;
            }
            if (!this.receivedAssetDeviceLists.includes(src)) {
                this.receivedAssetDeviceLists.push(src);
            }
            return deviceList.reduce((updatedDevices, data) => {
                const flatData = flattenDeviceData(data), existingDevice = updatedDevices.find((x) => x.zid === flatData.zid);
                if (existingDevice) {
                    existingDevice.updateData(flatData);
                    return updatedDevices;
                }
                return [...updatedDevices, new ring_device_1.RingDevice(flatData, this, src)];
            }, devices);
        }, []), (0, operators_1.distinctUntilChanged)((a, b) => a.length === b.length), (0, operators_1.filter)(() => {
            return Boolean(this.assets &&
                this.assets.every((asset) => this.receivedAssetDeviceLists.includes(asset.uuid)));
        }), (0, operators_1.shareReplay)(1));
        this.onSessionInfo = this.onDataUpdate.pipe((0, operators_1.filter)((m) => m.msg === 'SessionInfo'), (0, operators_1.map)((m) => m.body));
        this.onConnected = new rxjs_1.BehaviorSubject(false);
        this.onLocationMode = new rxjs_1.ReplaySubject(1);
        this.onLocationModeRequested = new rxjs_1.Subject();
        this.reconnecting = false;
        this.disconnected = false;
        this.receivedAssetDeviceLists = [];
        this.offlineAssets = [];
        this.hasHubs = this.options.hasHubs;
        this.hasAlarmBaseStation = this.options.hasAlarmBaseStation;
        this.addSubscriptions(
        // start listening for devices immediately
        this.onDevices.subscribe(), 
        // watch for sessions to come online
        this.onSessionInfo.subscribe((sessions) => {
            sessions.forEach(({ connectionStatus, assetUuid }) => {
                const assetWasOffline = this.offlineAssets.includes(assetUuid), asset = this.assets && this.assets.find((x) => x.uuid === assetUuid);
                if (!asset) {
                    // we don't know about this asset, so don't worry about it
                    return;
                }
                if (connectionStatus === 'online') {
                    if (assetWasOffline) {
                        // eslint-disable-next-line @typescript-eslint/no-empty-function
                        this.requestList(deviceListMessageType, assetUuid).catch(() => { });
                        this.offlineAssets = this.offlineAssets.filter((id) => id !== assetUuid);
                        (0, util_1.logInfo)(`Ring ${asset.kind} ${assetUuid} has come back online`);
                    }
                }
                else if (!assetWasOffline) {
                    (0, util_1.logError)(`Ring ${asset.kind} ${assetUuid} is offline or on cellular backup.  Waiting for status to change`);
                    this.offlineAssets.push(assetUuid);
                }
            });
        }));
        if (!options.hasAlarmBaseStation && options.locationModePollingSeconds) {
            this.addSubscriptions((0, rxjs_1.merge)(this.onLocationModeRequested, this.onLocationMode)
                .pipe((0, operators_1.debounceTime)(options.locationModePollingSeconds * 1000))
                .subscribe(() => this.getLocationMode()));
            this.getLocationMode().catch(util_1.logError);
        }
    }
    get id() {
        return this.locationId;
    }
    get locationId() {
        return this.locationDetails.location_id;
    }
    get name() {
        return this.locationDetails.name;
    }
    async createConnection() {
        if (this.disconnected) {
            return Promise.resolve({ disconnected: true });
        }
        (0, util_1.logInfo)('Creating location socket.io connection - ' + this.name);
        if (process.version.startsWith('v15.')) {
            (0, util_1.logError)('Node 15 is not currently supported by the Ring client. Please install the latest Node 14 instead. May not be able to fetch devices from Ring Alarm and Smart Lighting Hubs on this version of node.');
        }
        const { assets, ticket, host } = await this.restClient.request({
            url: (0, rest_client_1.appApi)('clap/tickets?locationID=' + this.id),
        }), supportedAssets = assets.filter(ring_types_1.isWebSocketSupportedAsset);
        this.assets = supportedAssets;
        this.receivedAssetDeviceLists.length = 0;
        this.offlineAssets.length = 0;
        if (!supportedAssets.length) {
            const errorMessage = `No assets (alarm hubs or beam bridges) found for location ${this.name} - ${this.id}`;
            (0, util_1.logError)(errorMessage);
            throw new Error(errorMessage);
        }
        const connection = (0, socket_io_client_1.connect)(`wss://${host}/?authcode=${ticket}&ack=false&EIO=3`, { transports: ['websocket'] }), reconnect = () => {
            if (this.reconnecting && this.connectionPromise) {
                return this.connectionPromise;
            }
            this.onConnected.next(false);
            if (!this.disconnected) {
                (0, util_1.logInfo)('Reconnecting location socket.io connection');
            }
            this.reconnecting = true;
            connection.close();
            return (this.connectionPromise = (0, util_1.delay)(1000).then(() => {
                return this.createConnection();
            }));
        };
        this.reconnecting = false;
        connection.on('DataUpdate', (message) => {
            if (message.datatype === 'HubDisconnectionEventType') {
                (0, util_1.logInfo)('Location connection told to reconnect');
                return reconnect();
            }
            this.onDataUpdate.next(message);
        });
        connection.on('message', (message) => this.onMessage.next(message));
        connection.on('error', reconnect);
        connection.on('disconnect', reconnect);
        return new Promise((resolve, reject) => {
            connection.once('connect', () => {
                resolve(connection);
                this.onConnected.next(true);
                (0, util_1.logInfo)('Ring connected to socket.io server');
                assets.forEach((asset) => this.requestList(deviceListMessageType, asset.uuid));
            });
            connection.once('error', reject);
        }).catch(reconnect);
    }
    getConnection() {
        if (!this.hasHubs) {
            return Promise.reject(new Error(`Location ${this.name} does not have any hubs`));
        }
        if (this.connectionPromise) {
            return this.connectionPromise;
        }
        return (this.connectionPromise = this.createConnection());
    }
    async sendMessage(message) {
        const connection = await this.getConnection();
        message.seq = this.seq++;
        connection.emit('message', message);
    }
    async sendCommandToSecurityPanel(commandType, data) {
        const securityPanel = await this.getSecurityPanel();
        securityPanel.sendCommand(commandType, data);
    }
    async setAlarmMode(alarmMode, bypassSensorZids) {
        const securityPanel = await this.getSecurityPanel(), updatedDataPromise = (0, rxjs_1.firstValueFrom)(securityPanel.onData.pipe((0, operators_1.skip)(1)));
        await this.sendCommandToSecurityPanel('security-panel.switch-mode', {
            mode: alarmMode,
            bypass: bypassSensorZids,
        });
        const updatedData = await updatedDataPromise;
        if (updatedData.mode !== alarmMode) {
            throw new Error(`Failed to set alarm mode to "${alarmMode}".  Sensors may require bypass, which can only be done in the Ring app.`);
        }
    }
    async getAlarmMode() {
        const securityPanel = await this.getSecurityPanel();
        return securityPanel.data.mode;
    }
    soundSiren() {
        return this.sendCommandToSecurityPanel('security-panel.sound-siren');
    }
    silenceSiren() {
        return this.sendCommandToSecurityPanel('security-panel.silence-siren');
    }
    setLightGroup(groupId, on, durationSeconds = 60) {
        return this.restClient.request({
            method: 'POST',
            url: `https://api.ring.com/groups/v1/locations/${this.id}/groups/${groupId}/devices`,
            json: {
                lights_on: {
                    duration_seconds: durationSeconds,
                    enabled: on,
                },
            },
        });
    }
    getNextMessageOfType(type, src) {
        return (0, rxjs_1.firstValueFrom)(this.onMessage.pipe((0, operators_1.filter)((m) => m.msg === type && m.src === src), (0, operators_1.map)((m) => m.body)));
    }
    requestList(listType, assetId) {
        return this.sendMessage({ msg: listType, dst: assetId });
    }
    async getList(listType, assetId) {
        await this.requestList(listType, assetId);
        return this.getNextMessageOfType(listType, assetId);
    }
    async getDevices() {
        if (!this.hasHubs) {
            return Promise.resolve([]);
        }
        if (!this.connectionPromise) {
            await this.getConnection();
        }
        return (0, rxjs_1.firstValueFrom)(this.onDevices);
    }
    getRoomList(assetId) {
        return this.getList('RoomGetList', assetId);
    }
    async getSecurityPanel() {
        if (this.securityPanel) {
            return this.securityPanel;
        }
        const devices = await this.getDevices(), securityPanel = devices.find((device) => {
            return device.data.deviceType === ring_types_1.RingDeviceType.SecurityPanel;
        });
        if (!securityPanel) {
            throw new Error(`Could not find a security panel for location ${this.name} - ${this.id}`);
        }
        return (this.securityPanel = securityPanel);
    }
    disarm() {
        return this.setAlarmMode('none');
    }
    armHome(bypassSensorZids) {
        return this.setAlarmMode('some', bypassSensorZids);
    }
    armAway(bypassSensorZids) {
        return this.setAlarmMode('all', bypassSensorZids);
    }
    getHistory(options = {}) {
        options.maxLevel = options.maxLevel || 50;
        return this.restClient.request({
            url: (0, rest_client_1.appApi)(`rs/history${(0, ring_camera_1.getSearchQueryString)({
                accountId: this.id,
                ...options,
            })}`),
        });
    }
    getCameraEvents(options = {}) {
        return this.restClient.request({
            url: (0, rest_client_1.clientApi)(`locations/${this.id}/events${(0, ring_camera_1.getSearchQueryString)(options)}`),
        });
    }
    getAccountMonitoringStatus() {
        return this.restClient.request({
            url: (0, rest_client_1.appApi)('rs/monitoring/accounts/' + this.id),
        });
    }
    triggerAlarm(signalType) {
        const now = Date.now(), alarmSessionUuid = (0, util_1.generateUuid)(), baseStationAsset = this.assets && this.assets.find((x) => x.kind === 'base_station_v1');
        if (!baseStationAsset) {
            throw new Error('Cannot dispatch panic events without an alarm base station');
        }
        return this.restClient.request({
            method: 'POST',
            url: (0, rest_client_1.appApi)(`rs/monitoring/accounts/${this.id}/assets/${baseStationAsset.uuid}/userAlarm`),
            json: {
                alarmSessionUuid,
                currentTsMs: now,
                eventOccurredTime: now,
                signalType,
            },
        });
    }
    triggerBurglarAlarm() {
        return this.triggerAlarm(ring_types_1.DispatchSignalType.Burglar);
    }
    triggerFireAlarm() {
        return this.triggerAlarm(ring_types_1.DispatchSignalType.Fire);
    }
    async getLocationMode() {
        this.onLocationModeRequested.next(null);
        const response = await this.restClient.request({
            method: 'GET',
            url: (0, rest_client_1.appApi)(`mode/location/${this.id}`),
        });
        this.onLocationMode.next(response.mode);
        return response;
    }
    async setLocationMode(mode) {
        const response = await this.restClient.request({
            method: 'POST',
            url: (0, rest_client_1.appApi)(`mode/location/${this.id}`),
            json: { mode },
        });
        this.onLocationMode.next(response.mode);
        return response;
    }
    async disableLocationModes() {
        await this.restClient.request({
            method: 'DELETE',
            url: (0, rest_client_1.appApi)(`mode/location/${this.id}/settings`),
        });
        this.onLocationMode.next('disabled');
    }
    async enableLocationModes() {
        const response = await this.restClient.request({
            method: 'POST',
            url: (0, rest_client_1.appApi)(`mode/location/${this.id}/settings/setup`),
        });
        await this.getLocationMode();
        return response;
    }
    getLocationModeSettings() {
        return this.restClient.request({
            method: 'GET',
            url: (0, rest_client_1.appApi)(`mode/location/${this.id}/settings`),
        });
    }
    setLocationModeSettings(settings) {
        return this.restClient.request({
            method: 'POST',
            url: (0, rest_client_1.appApi)(`mode/location/${this.id}/settings`),
            json: settings,
        });
    }
    getLocationModeSharing() {
        return this.restClient.request({
            method: 'GET',
            url: (0, rest_client_1.appApi)(`mode/location/${this.id}/sharing`),
        });
    }
    setLocationModeSharing(sharedUsersEnabled) {
        return this.restClient.request({
            method: 'POST',
            url: (0, rest_client_1.appApi)(`mode/location/${this.id}/sharing`),
            json: { sharedUsersEnabled },
        });
    }
    async supportsLocationModeSwitching() {
        if (this.hasAlarmBaseStation || !this.cameras.length) {
            return false;
        }
        const modeResponse = await this.getLocationMode(), { mode, readOnly } = modeResponse;
        (0, util_1.logDebug)('Location Mode: ' + JSON.stringify(modeResponse));
        return !readOnly && !ring_types_1.disabledLocationModes.includes(mode);
    }
    disconnect() {
        this.disconnected = true;
        this.unsubscribe();
        this.cameras.forEach((camera) => camera.disconnect());
        this.getDevices()
            .then((devices) => {
            devices.forEach((device) => device.disconnect());
        })
            .catch(util_1.logError);
        if (this.connectionPromise) {
            this.connectionPromise
                .then((connection) => connection.close())
                .catch(util_1.logError);
        }
    }
}
exports.Location = Location;
