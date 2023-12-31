import { RtpPacket } from 'werift';
import { ReplaySubject, Subject } from 'rxjs';
import { WebrtcConnection } from './webrtc-connection';
import { RingCamera } from '../ring-camera';
import { Subscribed } from '../subscribed';
type SpawnInput = string | number;
export interface FfmpegOptions {
    input?: SpawnInput[];
    video?: SpawnInput[] | false;
    audio?: SpawnInput[];
    output: SpawnInput[];
}
export declare class StreamingSession extends Subscribed {
    private readonly camera;
    private connection;
    readonly onCallEnded: ReplaySubject<void>;
    private readonly onUsingOpus;
    readonly onVideoRtp: Subject<RtpPacket>;
    readonly onAudioRtp: Subject<RtpPacket>;
    private readonly audioSplitter;
    private readonly videoSplitter;
    private readonly returnAudioSplitter;
    constructor(camera: RingCamera, connection: WebrtcConnection);
    private bindToConnection;
    /**
     * @deprecated
     * activate will be removed in the future. Please use requestKeyFrame if you want to explicitly request an initial key frame
     */
    activate(): void;
    cameraSpeakerActivated: boolean;
    activateCameraSpeaker(): void;
    reservePort(bufferPorts?: number): Promise<number>;
    get isUsingOpus(): Promise<boolean>;
    startTranscoding(ffmpegOptions: FfmpegOptions): Promise<void>;
    transcodeReturnAudio(ffmpegOptions: {
        input: SpawnInput[];
    }): Promise<void>;
    private hasEnded;
    private callEnded;
    stop(): void;
    sendAudioPacket(rtp: RtpPacket): void;
    requestKeyFrame(): void;
}
export {};
