/// <reference types="node" />
import { CameraData, CameraDeviceSettingsData, CameraEventOptions, CameraEventResponse, CameraHealth, HistoryOptions, PeriodicFootageResponse, PushNotification, PushNotificationDing, VideoSearchResponse, OnvifCameraData, RingCameraKind } from './ring-types';
import { RingRestClient } from './rest-client';
import { BehaviorSubject, Subject } from 'rxjs';
import { DeepPartial } from './util';
import { Subscribed } from './subscribed';
import { StreamingConnectionOptions } from './streaming/webrtc-connection';
import { FfmpegOptions, StreamingSession } from './streaming/streaming-session';
import { SimpleWebRtcSession } from './streaming/simple-webrtc-session';
export type AnyCameraData = CameraData | OnvifCameraData;
export declare function getBatteryLevel(data: Pick<CameraData, 'battery_life' | 'battery_life_2'> & {
    health?: Partial<CameraData['health']>;
}): number | null;
export declare function getSearchQueryString(options: CameraEventOptions | (HistoryOptions & {
    accountId: string;
})): string;
export declare function cleanSnapshotUuid(uuid?: string | null): string | null | undefined;
export declare class RingCamera extends Subscribed {
    private initialData;
    isDoorbot: boolean;
    private restClient;
    private avoidSnapshotBatteryDrain;
    id: number;
    deviceType: RingCameraKind.onvif_camera | Omit<RingCameraKind, RingCameraKind.onvif_camera>;
    model: string;
    onData: BehaviorSubject<AnyCameraData>;
    hasLight: boolean;
    hasSiren: boolean;
    onRequestUpdate: Subject<unknown>;
    onNewNotification: Subject<PushNotificationDing>;
    onActiveNotifications: BehaviorSubject<PushNotificationDing[]>;
    onDoorbellPressed: import("rxjs").Observable<PushNotificationDing>;
    onMotionDetected: import("rxjs").Observable<boolean>;
    onMotionStarted: import("rxjs").Observable<null>;
    onBatteryLevel: import("rxjs").Observable<number | null>;
    onInHomeDoorbellStatus: import("rxjs").Observable<boolean>;
    constructor(initialData: AnyCameraData, isDoorbot: boolean, restClient: RingRestClient, avoidSnapshotBatteryDrain: boolean);
    updateData(update: AnyCameraData): void;
    requestUpdate(): void;
    get data(): AnyCameraData;
    get name(): string;
    get activeNotifications(): PushNotificationDing[];
    get latestNotification(): PushNotificationDing | undefined;
    get latestNotificationSnapshotUuid(): string | undefined;
    get batteryLevel(): number | null;
    get hasBattery(): boolean;
    get hasLowBattery(): boolean;
    get isCharging(): boolean;
    get operatingOnBattery(): boolean;
    get isOffline(): boolean;
    get isRingEdgeEnabled(): boolean;
    get hasInHomeDoorbell(): boolean;
    doorbotUrl(path?: string): string;
    deviceUrl(path?: string): string;
    setLight(on: boolean): Promise<boolean>;
    setSiren(on: boolean): Promise<boolean>;
    setSettings(settings: DeepPartial<CameraData['settings']>): Promise<void>;
    setDeviceSettings(settings: DeepPartial<CameraDeviceSettingsData>): Promise<CameraDeviceSettingsData & import("./rest-client").ExtendedResponse>;
    getDeviceSettings(): Promise<CameraDeviceSettingsData & import("./rest-client").ExtendedResponse>;
    setInHomeDoorbell(enable: boolean): Promise<boolean>;
    getHealth(): Promise<CameraHealth>;
    private createStreamingConnection;
    startLiveCall(options?: StreamingConnectionOptions): Promise<StreamingSession>;
    private removeDingById;
    processPushNotification(notification: PushNotification): void;
    getEvents(options?: CameraEventOptions): Promise<CameraEventResponse & import("./rest-client").ExtendedResponse>;
    videoSearch({ dateFrom, dateTo, order }?: {
        dateFrom: number;
        dateTo: number;
        order?: string | undefined;
    }): Promise<VideoSearchResponse & import("./rest-client").ExtendedResponse>;
    getPeriodicalFootage({ startAtMs, endAtMs }?: {
        startAtMs: number;
        endAtMs: number;
    }): Promise<PeriodicFootageResponse & import("./rest-client").ExtendedResponse>;
    getRecordingUrl(dingIdStr: string, { transcoded }?: {
        transcoded?: boolean | undefined;
    }): Promise<string>;
    private isTimestampInLifeTime;
    get snapshotsAreBlocked(): boolean;
    get snapshotLifeTime(): number;
    private lastSnapshotTimestamp;
    private lastSnapshotTimestampLocal;
    private lastSnapshotPromise?;
    get currentTimestampAge(): number;
    get hasSnapshotWithinLifetime(): boolean;
    private checkIfSnapshotsAreBlocked;
    private shouldUseExistingSnapshotPromise;
    private fetchingSnapshot;
    getSnapshot({ uuid }?: {
        uuid?: string;
    }): Promise<Buffer>;
    getNextSnapshot({ afterMs, maxWaitMs, force, uuid, }: {
        afterMs?: number;
        maxWaitMs?: number;
        force?: boolean;
        uuid?: string;
    }): Promise<Buffer & import("./rest-client").ExtendedResponse>;
    getSnapshotByUuid(uuid: string): Promise<Buffer & import("./rest-client").ExtendedResponse>;
    recordToFile(outputPath: string, duration?: number): Promise<void>;
    streamVideo(ffmpegOptions: FfmpegOptions): Promise<StreamingSession>;
    /**
     * Returns a SimpleWebRtcSession, which can be initiated with an sdp offer.
     * This session has no backplane for trickle ICE, and is designed for use in a
     * browser setting.  Note, cameras with Ring Edge enabled will stream with the speaker
     * enabled as soon as the stream starts, which can drain the battery more quickly.
     */
    createSimpleWebRtcSession(): SimpleWebRtcSession;
    subscribeToDingEvents(): Promise<void & import("./rest-client").ExtendedResponse>;
    unsubscribeFromDingEvents(): Promise<void & import("./rest-client").ExtendedResponse>;
    subscribeToMotionEvents(): Promise<void & import("./rest-client").ExtendedResponse>;
    unsubscribeFromMotionEvents(): Promise<void & import("./rest-client").ExtendedResponse>;
    disconnect(): void;
}
