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
	LoginResponse,
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

	private _reloadPromise: Promise<void> | undefined;

	private readonly _onDidAuthStateChange = this._register(new Emitter<AuthState>());
	readonly onDidAuthStateChange: Event<AuthState> = this._onDidAuthStateChange.event;

	private readonly apiClient: ApiClient;

	constructor(
		@ISecretStorageService private readonly secretStorage: ISecretStorageService,
		@ICommandService private readonly commandService: ICommandService
	) {
		super();
		this.apiClient = new ApiClient();
		console.log('[StudentAuth] Service initialized');

		// Listen for secret storage changes so multiple windows/processes
		// can pick up auth state updates immediately.
		this._register(this.secretStorage.onDidChangeSecret(async (key: string) => {
			if (key === STUDENT_AUTH_TOKEN_KEY || key === STUDENT_AUTH_REFRESH_TOKEN_KEY || key === STUDENT_AUTH_STUDENT_ID_KEY) {
				try {
					await this.reloadTokens();
				} catch (e) {
					console.error('[StudentAuth] reloadTokens error:', e);
				}
			}
		}));
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
	 * Reload tokens from the secret storage and update in-memory state.
	 * This is guarded to avoid concurrent reloads.
	 */
	private async reloadTokens(): Promise<void> {
		if (this._reloadPromise) {
			return this._reloadPromise;
		}

		this._reloadPromise = (async () => {
			console.log('[StudentAuth] Reloading tokens from secret storage');
			try {
				const access = await this.secretStorage.get(STUDENT_AUTH_TOKEN_KEY);
				const refresh = await this.secretStorage.get(STUDENT_AUTH_REFRESH_TOKEN_KEY);
				const sid = await this.secretStorage.get(STUDENT_AUTH_STUDENT_ID_KEY);

				this._accessToken = access;
				this._refreshToken = refresh;
				this._studentId = sid;

				if (this._accessToken) {
					if (isTokenExpired(this._accessToken)) {
						console.log('[StudentAuth] Reloaded access token is expired, attempting refresh...');
						const refreshed = await this.refreshAccessToken();
						if (!refreshed) {
							this.apiClient.removeAuthToken();
							this.setState(AuthState.Unauthenticated);
							return;
						}
						this.setState(AuthState.Authenticated);
					} else {
						this.apiClient.setAuthToken(this._accessToken);
						this.setState(AuthState.Authenticated);
					}
				} else if (this._refreshToken) {
					// No access token but have refresh token: try refresh
					const refreshed = await this.refreshAccessToken();
					if (refreshed) {
						this.setState(AuthState.Authenticated);
						return;
					}
					this.apiClient.removeAuthToken();
					this.setState(AuthState.Unauthenticated);
				} else {
					// No auth present
					this.apiClient.removeAuthToken();
					this.setState(AuthState.Unauthenticated);
				}
			} finally {
				this._reloadPromise = undefined;
			}
		})();

		return this._reloadPromise;
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

			// Full workbench reload to ensure all windows and components pick up
			// the new authentication state (behaves like Ctrl+R). This avoids
			// stale in-memory state in long-lived components. Keep it delayed
			// briefly to allow storage writes to flush.
			try {
				setTimeout(() => {
					void this.commandService.executeCommand('workbench.action.reloadWindow');
				}, 150);
			} catch (e) {
				console.error('[StudentAuth] Failed to reload window after login:', e);
			}

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
			console.log('[StudentAuth] Refreshing access token via backend...');

			// Call backend refresh endpoint. Backend returns the same shape as login:
			// { user: { user_id, refresh_token, ... }, access_token, token_type }
			const response = await this.apiClient.post<LoginResponse>('/users/refresh', {
				refresh_token: this._refreshToken
			});

			if (!response.success || !response.data) {
				console.error('[StudentAuth] Token refresh failed');
				await this.clearTokens();
				this.setState(AuthState.Unauthenticated);
				return false;
			}

			const data = response.data;

			// Accept either direct access_token or login-shaped response
			const newAccessToken: string | undefined = data.access_token;
			const newRefreshToken: string | undefined = data.refresh_token || (data.user && data.user.refresh_token);

			console.log(`[STUDENT AUTH SERVICE - NEW REFRESH TOKEN] - ${newRefreshToken}`);

			const user = data.user;

			if (!newAccessToken) {
				console.error('[StudentAuth] Refresh response missing access token');
				await this.clearTokens();
				this.setState(AuthState.Unauthenticated);
				return false;
			}

			// Update memory
			this._accessToken = newAccessToken;
			if (newRefreshToken) {
				this._refreshToken = newRefreshToken;
			}
			if (user && user.user_id) {
				this._studentId = user.user_id;
				await this.secretStorage.set(STUDENT_AUTH_STUDENT_ID_KEY, user.user_id);
			}

			// Persist tokens
			await this.secretStorage.set(STUDENT_AUTH_TOKEN_KEY, this._accessToken);
			if (this._refreshToken) {
				await this.secretStorage.set(STUDENT_AUTH_REFRESH_TOKEN_KEY, this._refreshToken);
			}

			// Update API client
			this.apiClient.setAuthToken(this._accessToken);

			console.log('[StudentAuth] Token refresh successful (backend)');
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
				await this.apiClient.post('/users/logout', {});
			}
		} catch (error) {
			console.warn('[StudentAuth] Logout API call failed:', error);
		} finally {
			await this.clearTokens();
			this.setState(AuthState.Unauthenticated);
			console.log('[StudentAuth] Logout complete');
			// Open the sign-in overlay so the user can re-authenticate immediately
			try {
				this.commandService.executeCommand('student.signIn');
			} catch (e) {
				console.error('[StudentAuth] Failed to open sign-in overlay after logout:', e);
			}
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
		this._accessToken = authContext.access_token;
		this._refreshToken = authContext.user.refresh_token;
		this._studentId = authContext.user.user_id;

		await this.secretStorage.set(STUDENT_AUTH_TOKEN_KEY, authContext.access_token);

		if (authContext.user.refresh_token) {
			await this.secretStorage.set(STUDENT_AUTH_REFRESH_TOKEN_KEY, authContext.user.refresh_token);
		}

		if (authContext.user.user_id) {
			await this.secretStorage.set(STUDENT_AUTH_STUDENT_ID_KEY, authContext.user.user_id);
		}

		// Set token in API client
		this.apiClient.setAuthToken(authContext.access_token);
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
