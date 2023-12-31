"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamingSession = void 0;
const werift_1 = require("werift");
const camera_utils_1 = require("@homebridge/camera-utils");
const rxjs_1 = require("rxjs");
const ffmpeg_1 = require("../ffmpeg");
const util_1 = require("../util");
const operators_1 = require("rxjs/operators");
const subscribed_1 = require("../subscribed");
function getCleanSdp(sdp, includeVideo) {
    return sdp
        .split('\nm=')
        .slice(1)
        .map((section) => 'm=' + section)
        .filter((section) => includeVideo || !section.startsWith('m=video'))
        .join('\n');
}
class StreamingSession extends subscribed_1.Subscribed {
    constructor(camera, connection) {
        super();
        this.camera = camera;
        this.connection = connection;
        this.onCallEnded = new rxjs_1.ReplaySubject(1);
        this.onUsingOpus = new rxjs_1.ReplaySubject(1);
        this.onVideoRtp = new rxjs_1.Subject();
        this.onAudioRtp = new rxjs_1.Subject();
        this.audioSplitter = new camera_utils_1.RtpSplitter();
        this.videoSplitter = new camera_utils_1.RtpSplitter();
        this.returnAudioSplitter = new camera_utils_1.RtpSplitter();
        this.cameraSpeakerActivated = false;
        this.hasEnded = false;
        this.bindToConnection(connection);
    }
    bindToConnection(connection) {
        this.addSubscriptions(connection.onAudioRtp.subscribe(this.onAudioRtp), connection.onVideoRtp.subscribe(this.onVideoRtp), connection.onCallAnswered.subscribe((sdp) => {
            this.onUsingOpus.next(sdp.toLocaleLowerCase().includes(' opus/'));
        }), connection.onCallEnded.subscribe(() => this.callEnded()));
    }
    /**
     * @deprecated
     * activate will be removed in the future. Please use requestKeyFrame if you want to explicitly request an initial key frame
     */
    activate() {
        this.requestKeyFrame();
    }
    activateCameraSpeaker() {
        if (this.cameraSpeakerActivated || this.hasEnded) {
            return;
        }
        this.cameraSpeakerActivated = true;
        this.connection.activateCameraSpeaker();
    }
    async reservePort(bufferPorts = 0) {
        const ports = await (0, camera_utils_1.reservePorts)({ count: bufferPorts + 1 });
        return ports[0];
    }
    get isUsingOpus() {
        return (0, rxjs_1.firstValueFrom)(this.onUsingOpus.pipe((0, operators_1.mergeWith)(this.connection.onError.pipe((0, operators_1.map)((e) => {
            throw e;
        })))));
    }
    async startTranscoding(ffmpegOptions) {
        if (this.hasEnded) {
            return;
        }
        const videoPort = await this.reservePort(1), audioPort = await this.reservePort(1), transcodeVideoStream = ffmpegOptions.video !== false, ringSdp = await Promise.race([
            (0, rxjs_1.firstValueFrom)(this.connection.onCallAnswered),
            (0, rxjs_1.firstValueFrom)(this.onCallEnded),
        ]);
        if (!ringSdp) {
            (0, util_1.logDebug)('Call ended before answered');
            return;
        }
        const usingOpus = await this.isUsingOpus, ffmpegInputArguments = [
            '-hide_banner',
            '-protocol_whitelist',
            'pipe,udp,rtp,file,crypto',
            // Ring will answer with either opus or pcmu
            ...(usingOpus ? ['-acodec', 'libopus'] : []),
            '-f',
            'sdp',
            ...(ffmpegOptions.input || []),
            '-i',
            'pipe:',
        ], inputSdp = getCleanSdp(ringSdp, transcodeVideoStream)
            .replace(/m=audio \d+/, `m=audio ${audioPort}`)
            .replace(/m=video \d+/, `m=video ${videoPort}`), ff = new camera_utils_1.FfmpegProcess({
            ffmpegArgs: ffmpegInputArguments.concat(...(ffmpegOptions.audio || ['-acodec', 'aac']), ...(transcodeVideoStream
                ? ffmpegOptions.video || ['-vcodec', 'copy']
                : []), ...(ffmpegOptions.output || [])),
            ffmpegPath: (0, ffmpeg_1.getFfmpegPath)(),
            exitCallback: () => this.callEnded(),
            logLabel: `From Ring (${this.camera.name})`,
            logger: {
                error: util_1.logError,
                info: util_1.logDebug,
            },
        });
        this.addSubscriptions(this.onAudioRtp
            .pipe((0, operators_1.concatMap)((rtp) => {
            return this.audioSplitter.send(rtp.serialize(), {
                port: audioPort,
            });
        }))
            .subscribe());
        if (transcodeVideoStream) {
            this.addSubscriptions(this.onVideoRtp
                .pipe((0, operators_1.concatMap)((rtp) => {
                return this.videoSplitter.send(rtp.serialize(), {
                    port: videoPort,
                });
            }))
                .subscribe());
        }
        this.onCallEnded.pipe((0, operators_1.take)(1)).subscribe(() => ff.stop());
        ff.writeStdin(inputSdp);
        // Request a key frame now that ffmpeg is ready to receive
        this.requestKeyFrame();
    }
    async transcodeReturnAudio(ffmpegOptions) {
        if (this.hasEnded) {
            return;
        }
        const audioOutForwarder = new camera_utils_1.RtpSplitter(({ message }) => {
            const rtp = werift_1.RtpPacket.deSerialize(message);
            this.connection.sendAudioPacket(rtp);
            return null;
        }), usingOpus = await this.isUsingOpus, ff = new camera_utils_1.FfmpegProcess({
            ffmpegArgs: [
                '-hide_banner',
                '-protocol_whitelist',
                'pipe,udp,rtp,file,crypto',
                '-re',
                '-i',
                ...ffmpegOptions.input,
                '-acodec',
                ...(usingOpus
                    ? ['libopus', '-ac', 2, '-ar', '48k']
                    : ['pcm_mulaw', '-ac', 1, '-ar', '8k']),
                '-flags',
                '+global_header',
                '-f',
                'rtp',
                `rtp://127.0.0.1:${await audioOutForwarder.portPromise}`,
            ],
            ffmpegPath: (0, ffmpeg_1.getFfmpegPath)(),
            exitCallback: () => this.callEnded(),
            logLabel: `Return Audio (${this.camera.name})`,
            logger: {
                error: util_1.logError,
                info: util_1.logDebug,
            },
        });
        this.onCallEnded.pipe((0, operators_1.take)(1)).subscribe(() => ff.stop());
    }
    callEnded() {
        if (this.hasEnded) {
            return;
        }
        this.hasEnded = true;
        this.unsubscribe();
        this.onCallEnded.next();
        this.connection.stop();
        this.audioSplitter.close();
        this.videoSplitter.close();
        this.returnAudioSplitter.close();
    }
    stop() {
        this.callEnded();
    }
    sendAudioPacket(rtp) {
        if (this.hasEnded) {
            return;
        }
        this.connection.sendAudioPacket(rtp);
    }
    requestKeyFrame() {
        this.connection.requestKeyFrame();
    }
}
exports.StreamingSession = StreamingSession;
