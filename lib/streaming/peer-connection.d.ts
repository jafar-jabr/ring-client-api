import { ConnectionState, MediaStreamTrack, RTCIceCandidate, RtcpPacket, RtpPacket } from 'werift';
import { Observable, ReplaySubject, Subject } from 'rxjs';
import { Subscribed } from '../subscribed';
export interface BasicPeerConnection {
    createOffer(): Promise<{
        sdp: string;
    }>;
    acceptAnswer(answer: {
        type: 'answer';
        sdp: string;
    }): Promise<void>;
    addIceCandidate(candidate: Partial<RTCIceCandidate>): Promise<void>;
    onIceCandidate: Observable<RTCIceCandidate>;
    onConnectionState: Observable<ConnectionState>;
    close(): void;
    requestKeyFrame?: () => void;
}
export declare class WeriftPeerConnection extends Subscribed implements BasicPeerConnection {
    private pc;
    onAudioRtp: Subject<RtpPacket>;
    onAudioRtcp: Subject<RtcpPacket>;
    onVideoRtp: Subject<RtpPacket>;
    onVideoRtcp: Subject<RtcpPacket>;
    onIceCandidate: Subject<RTCIceCandidate>;
    onConnectionState: ReplaySubject<"connected" | "closed" | "failed" | "disconnected" | "new" | "connecting">;
    returnAudioTrack: MediaStreamTrack;
    private onRequestKeyFrame;
    constructor();
    createOffer(): Promise<import("werift").RTCSessionDescription>;
    acceptAnswer(answer: {
        type: 'answer';
        sdp: string;
    }): Promise<void>;
    addIceCandidate(candidate: RTCIceCandidate): Promise<void>;
    requestKeyFrame(): void;
    close(): void;
}
