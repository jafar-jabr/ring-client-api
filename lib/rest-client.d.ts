import { Options as RequestOptions } from 'got';
import { AuthTokenResponse, SessionResponse } from './ring-types';
import { ReplaySubject } from 'rxjs';
import type { Credentials } from '@eneris/push-receiver/dist/types';
export declare function clientApi(path: string): string;
export declare function deviceApi(path: string): string;
export declare function commandsApi(path: string): string;
export declare function appApi(path: string): string;
export interface ExtendedResponse {
    responseTimestamp: number;
    timeMillis: number;
}
export interface EmailAuth {
    email: string;
    password: string;
    systemId?: string;
    twoFactorAuthCode?: string;
}
export interface RefreshTokenAuth {
    refreshToken?: string;
    systemId?: string;
    twoFactorAuthCode?: string;
    password?: string;
    email?: string;
    other?: string;
}
export interface SessionOptions {
    controlCenterDisplayName?: string;
}
export declare class RingRestClient {
    private authOptions;
    refreshToken: string | undefined;
    private authConfig;
    private hardwareIdPromise;
    private _authPromise;
    private timeouts;
    private clearPreviousAuth;
    private get authPromise();
    private sessionPromise?;
    using2fa: boolean;
    promptFor2fa?: string;
    onRefreshTokenUpdated: ReplaySubject<{
        oldRefreshToken?: string | undefined;
        newRefreshToken: string;
    }>;
    onSession: ReplaySubject<SessionResponse>;
    readonly baseSessionMetadata: {
        api_version: number;
        device_model: string;
    };
    constructor(authOptions: (EmailAuth | RefreshTokenAuth) & SessionOptions);
    private getGrantData;
    getAuth(twoFactorAuthCode?: string): Promise<AuthTokenResponse>;
    private fetchNewSession;
    getSession(): Promise<SessionResponse>;
    private refreshAuth;
    private refreshSession;
    request<T = void>(options: RequestOptions & {
        url: string;
        allowNoResponse?: boolean;
    }): Promise<T & ExtendedResponse>;
    getCurrentAuth(): Promise<AuthTokenResponse>;
    clearTimeouts(): void;
    get _internalOnly_pushNotificationCredentials(): Credentials | undefined;
    set _internalOnly_pushNotificationCredentials(credentials: Credentials | undefined);
}
