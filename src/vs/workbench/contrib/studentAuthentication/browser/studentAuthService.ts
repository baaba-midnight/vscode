/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ApiClient } from '../common/apiClients.js';
import {
	IStudentAuthService,
	IAuthContext,
	AuthState,
	STUDENT_AUTH_TOKEN_KEY,
	STUDENT_AUTH_REFRESH_TOKEN_KEY,
	STUDENT_AUTH_STUDENT_ID_KEY,
	isTokenExpired,
	loginStudent
} from '../common/studentAuth.js';

/**
 * Platform service for managing student authentication.
 * Handles JWT lifecycle, token refresh, and secure storage.
 */
export class StudentAuthService extends Disposable implements IStudentAuthService {
	declare readonly _serviceBrand: undefined;

	private _state: AuthState = AuthState.Uninitialized;
	private _accessToken: string | undefined;
	private _refreshToken: string | undefined;
	private _studentId: string | undefined;
	private _initPromise: Promise<void> | undefined;

	private readonly _onDidAuthStateChange = this._register(new Emitter<AuthState>());
	readonly onDidAuthStateChange: Event<AuthState> = this._onDidAuthStateChange.event;

	private readonly apiClient: ApiClient;

	constructor(
		@ISecretStorageService private readonly secretStorage: ISecretStorageService,
		@ICommandService private readonly commandService: ICommandService
	) {
		super();
		this.apiClient = new ApiClient(commandService);
		console.log('[StudentAuth] Service initialized');
	}

	get state(): AuthState {
		return this._state;
	}

	get studentId(): string | undefined {
		return this._studentId;
	}

	/**
	 * Wait for the auth service to complete initialization
	 */
	async whenReady(): Promise<void> {
		if (!this._initPromise) {
			this._initPromise = this.initialize();
		}
		return this._initPromise;
	}

	/**
	 * Initialize the auth service by loading tokens from storage
	 */
	private async initialize(): Promise<void> {
		console.log('[StudentAuth] Initializing...');

		try {
			// Load tokens from secure storage
			this._accessToken = await this.secretStorage.get(STUDENT_AUTH_TOKEN_KEY);
			this._refreshToken = await this.secretStorage.get(STUDENT_AUTH_REFRESH_TOKEN_KEY);
			this._studentId = await this.secretStorage.get(STUDENT_AUTH_STUDENT_ID_KEY);

			if (this._accessToken) {
				// Check if token is expired
				if (isTokenExpired(this._accessToken)) {
					console.log('[StudentAuth] Access token expired, attempting refresh...');
					const refreshed = await this.refreshAccessToken();
					if (!refreshed) {
						// Refresh failed, clear tokens
						await this.clearTokens();
						this.setState(AuthState.Unauthenticated);
					} else {
						this.setState(AuthState.Authenticated);
					}
				} else {
					// Token is valid
					this.apiClient.setAuthToken(this._accessToken);
					this.setState(AuthState.Authenticated);
					console.log('[StudentAuth] Authenticated with valid token');
				}
			} else {
				this.setState(AuthState.Unauthenticated);
				console.log('[StudentAuth] No stored authentication found');
			}
		} catch (error) {
			console.error('[StudentAuth] Initialization failed:', error);
			this.setState(AuthState.Unauthenticated);
		}
	}

	/**
	 * Get a valid access token, refreshing if necessary
	 */
	async getValidAccessToken(): Promise<string | undefined> {
		await this.whenReady();

		if (!this._accessToken) {
			return undefined;
		}

		// Check if token is expired and refresh if needed
		if (isTokenExpired(this._accessToken)) {
			console.log('[StudentAuth] Token expired, refreshing...');
			const refreshed = await this.refreshAccessToken();
			if (!refreshed) {
				return undefined;
			}
		}

		return this._accessToken;
	}

	/**
	 * Perform login with email and password
	 */
	async login(email: string, password: string): Promise<IAuthContext> {
		console.log('[StudentAuth] Attempting login...');

		try {
			const authContext = await loginStudent(
				this.commandService,
				this.apiClient,
				email,
				password
			);

			// Store tokens
			await this.storeAuthContext(authContext);

			console.log('[StudentAuth] Login successful');
			this.setState(AuthState.Authenticated);

			return authContext;
		} catch (error) {
			console.error('[StudentAuth] Login failed:', error);
			this.setState(AuthState.Unauthenticated);
			throw error;
		}
	}

	/**
	 * Refresh the access token using the refresh token
	 */
	async refreshAccessToken(): Promise<boolean> {
		if (!this._refreshToken) {
			console.warn('[StudentAuth] No refresh token available');
			return false;
		}

		try {
			console.log('[StudentAuth] Refreshing access token...');

			const response = await this.apiClient.post<{
				access_token: string;
				refresh_token?: string;
				expires_in?: number;
			}>('/auth/refresh', {
				refresh_token: this._refreshToken
			});

			if (!response.success || !response.data) {
				console.error('[StudentAuth] Token refresh failed');
				await this.clearTokens();
				this.setState(AuthState.Unauthenticated);
				return false;
			}

			// Update tokens
			this._accessToken = response.data.access_token;
			if (response.data.refresh_token) {
				this._refreshToken = response.data.refresh_token;
			}

			// Store updated tokens
			await this.secretStorage.set(STUDENT_AUTH_TOKEN_KEY, this._accessToken);
			if (this._refreshToken) {
				await this.secretStorage.set(STUDENT_AUTH_REFRESH_TOKEN_KEY, this._refreshToken);
			}

			// Update API client
			this.apiClient.setAuthToken(this._accessToken);

			console.log('[StudentAuth] Token refresh successful');
			this.setState(AuthState.Authenticated);
			return true;
		} catch (error) {
			console.error('[StudentAuth] Token refresh error:', error);
			await this.clearTokens();
			this.setState(AuthState.Unauthenticated);
			return false;
		}
	}

	/**
	 * Logout and clear all stored tokens
	 */
	async logout(): Promise<void> {
		console.log('[StudentAuth] Logging out...');

		try {
			// Optionally call backend logout endpoint
			if (this._accessToken) {
				await this.apiClient.post('/auth/logout', {});
			}
		} catch (error) {
			console.warn('[StudentAuth] Logout API call failed:', error);
		} finally {
			await this.clearTokens();
			this.setState(AuthState.Unauthenticated);
			console.log('[StudentAuth] Logout complete');
		}
	}

	/**
	 * Check if tokens exist in storage
	 */
	async hasStoredAuth(): Promise<boolean> {
		const token = await this.secretStorage.get(STUDENT_AUTH_TOKEN_KEY);
		return !!token;
	}

	/**
	 * Store authentication context in secure storage
	 */
	private async storeAuthContext(authContext: IAuthContext): Promise<void> {
		this._accessToken = authContext.authToken;
		this._refreshToken = authContext.refreshToken;
		this._studentId = authContext.studentId;

		await this.secretStorage.set(STUDENT_AUTH_TOKEN_KEY, authContext.authToken);

		if (authContext.refreshToken) {
			await this.secretStorage.set(STUDENT_AUTH_REFRESH_TOKEN_KEY, authContext.refreshToken);
		}

		if (authContext.studentId) {
			await this.secretStorage.set(STUDENT_AUTH_STUDENT_ID_KEY, authContext.studentId);
		}

		// Set token in API client
		this.apiClient.setAuthToken(authContext.authToken);
	}

	/**
	 * Clear all tokens from storage and memory
	 */
	private async clearTokens(): Promise<void> {
		this._accessToken = undefined;
		this._refreshToken = undefined;
		this._studentId = undefined;

		await this.secretStorage.delete(STUDENT_AUTH_TOKEN_KEY);
		await this.secretStorage.delete(STUDENT_AUTH_REFRESH_TOKEN_KEY);
		await this.secretStorage.delete(STUDENT_AUTH_STUDENT_ID_KEY);

		this.apiClient.removeAuthToken();
	}

	/**
	 * Update state and fire event
	 */
	private setState(newState: AuthState): void {
		if (this._state !== newState) {
			this._state = newState;
			this._onDidAuthStateChange.fire(newState);
			console.log('[StudentAuth] State changed:', newState);
		}
	}

	override dispose(): void {
		super.dispose();
		console.log('[StudentAuth] Service disposed');
	}
}
