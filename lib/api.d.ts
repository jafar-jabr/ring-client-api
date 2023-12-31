import { RefreshTokenAuth, RingRestClient, SessionOptions } from './rest-client';
import { Location } from './location';
import { BaseStation, BeamBridge, CameraData, ChimeData, IntercomHandsetAudioData, OnvifCameraData, ProfileResponse, ThirdPartyGarageDoorOpener, UnknownDevice, UserLocation } from './ring-types';
import { AnyCameraData, RingCamera } from './ring-camera';
import { Subscribed } from './subscribed';
export interface RingApiOptions extends SessionOptions {
    locationIds?: string[];
    cameraStatusPollingSeconds?: number;
    locationModePollingSeconds?: number;
    avoidSnapshotBatteryDrain?: boolean;
    debug?: boolean;
    ffmpegPath?: string;
    externalPorts?: {
        start: number;
        end: number;
    };
}
export declare class RingApi extends Subscribed {
    readonly options: RingApiOptions & RefreshTokenAuth;
    readonly restClient: RingRestClient;
    readonly onRefreshTokenUpdated: import("rxjs").Observable<{
        oldRefreshToken?: string | undefined;
        newRefreshToken: string;
    }>;
    constructor(options: RingApiOptions & RefreshTokenAuth);
    fetchRingDevices(): Promise<{
        doorbots: CameraData[];
        chimes: ChimeData[];
        authorizedDoorbots: CameraData[];
        stickupCams: CameraData[];
        allCameras: AnyCameraData[];
        baseStations: BaseStation[];
        beamBridges: BeamBridge[];
        onvifCameras: OnvifCameraData[];
        thirdPartyGarageDoorOpeners: ThirdPartyGarageDoorOpener[];
        intercoms: IntercomHandsetAudioData[];
        unknownDevices: UnknownDevice[];
    }>;
    private listenForDeviceUpdates;
    private registerPushReceiver;
    fetchRawLocations(): Promise<UserLocation[]>;
    fetchAmazonKeyLocks(): Promise<any[] & import("./rest-client").ExtendedResponse>;
    fetchAndBuildLocations(): Promise<Location[]>;
    private locationsPromise;
    getLocations(): Promise<Location[]>;
    getCameras(): Promise<RingCamera[]>;
    getProfile(): Promise<ProfileResponse & import("./rest-client").ExtendedResponse>;
    disconnect(): void;
}
