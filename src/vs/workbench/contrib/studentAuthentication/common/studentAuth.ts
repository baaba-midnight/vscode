/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { ApiClient } from '../common/apiClients.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ISecretStorageProvider } from '../../../../platform/secrets/common/secrets.js';

export const IStudentAuthService = createDecorator<IStudentAuthService>('studentAuthService');

// authentication keys for user login and session management
export const STUDENT_AUTH_TOKEN_KEY = 'student-auth-token';
export const STUDENT_AUTH_REFRESH_TOKEN_KEY = 'student-auth-refresh-token';
export const STUDENT_AUTH_STUDENT_ID_KEY = 'student-auth-student-id';
export const STUDENT_AUTH_STUDENT_NAME_KEY = 'student-auth-student-name';
export const STUDENT_AUTH_STUDENT_EMAIL_KEY = 'student-auth-student-email';

// define authentication states
export enum AuthState {
	Uninitialized = 'uninitialized',
	Authenticated = 'authenticated',
	Unauthenticated = 'unauthenticated'
}

export enum UserRole {
	STUDENT = 'student',
	INSTRUCTOR = 'instructor',
	ADMIN = 'admin'
}

export interface UserBase {
	user_id?: string;
	access_token?: string;
	name: string;
	email: string;
	role: UserRole;
	created_at?: string;
	refresh_token?: string;
}


export interface IAuthContext {
	user: UserBase;
	access_token: string;
	token_type: string;
	expiresAt: number;
}
export interface LoginResponse {
	user: UserBase;
	access_token: string;
	token_type: string;
	expires_in?: number;   // seconds until expiry
	expiresAt?: number;    // absolute timestamp (ms)
	student_id?: string;
	refresh_token: string;
}


/*
*Student Authentication service which will be fully implemented in
*./contrib/studentAuthentication/browser/studentAuthService.ts
*/
export interface IStudentAuthService {
	readonly _serviceBrand: undefined;

	/* current auth state */
	readonly state: AuthState;

	/** current student id, if known */
	readonly studentId: string | undefined;
	readonly studentName: string | undefined;
	readonly studentEmail: string | undefined;

	/*
	* event fired with the state changes
	*/
	readonly onDidAuthStateChange: Event<AuthState>;

	/*
	* Promise that resolves when the auth service is fully initialized
	*/
	whenReady(): Promise<void>;

	/*
	* get a valid access token, refreshing if necessary @returns access token or undefined if not authenticated
	*/
	getValidAccessToken(): Promise<string | undefined>;

	/**
	 * Perform login with email and password
	 * @param email Student email
	 * @param password Student password
	 * @returns Authentication context with tokens
	 */
	login(email: string, password: string): Promise<IAuthContext>;

	/**
	 * Logout and clear all stored tokens
	 */
	logout(): Promise<void>;

	/**
	 * Check if tokens exist in storage
	 */
	hasStoredAuth(): Promise<boolean>;

	/**
	 * Refresh the access token using the refresh token
	 */
	refreshAccessToken(): Promise<boolean>;
}

/**
 * Helper function to check if stored authentication exists
 */
export async function hasStoredStudentAuth(secretStorage: ISecretStorageProvider): Promise<boolean> {
	const token = await secretStorage.get(STUDENT_AUTH_TOKEN_KEY);
	return !!token;
}

/**
 * Helper function to decode JWT and extract expiry
 */
export function decodeJWT(token: string): { exp?: number; key?: string } {
	try {
		const payload = token.split('.')[1];
		const decoded = JSON.parse(atob(payload));
		return decoded;
	} catch (error) {
		console.error('Failed to decode JWT:', error);
		return {};
	}
}

/**
 * Check if a JWT token is expired
 */
export function isTokenExpired(token: string): boolean {
	const decoded = decodeJWT(token);
	if (!decoded.exp) {
		return true;
	}
	// Add 30 second buffer to prevent edge cases
	return Date.now() >= (decoded.exp * 1000) - 30000;
}

/**
 * Login helper function to authenticate with backend
 */
export async function loginStudent(
	commandService: ICommandService,
	apiClient: ApiClient,
	email: string,
	password: string
): Promise<IAuthContext> {
	const response = await apiClient.post<LoginResponse>('/users/login', { email, password });

	if (!response.success || !response.data) {
		throw new Error('Login failed: Invalid credentials');
	}

	const data = response.data;

	// Build user object: prefer full `user` from response, otherwise construct minimal one
	const user: UserBase = data.user;

	// Compute expiresAt as an absolute timestamp in milliseconds.
	// Prefer `expires_in` (seconds until expiry) if provided, otherwise use `expiresAt` if backend returned it.
	let expiresAt: number;
	if (typeof data.expires_in === 'number') {
		expiresAt = Date.now() + data.expires_in * 1000;
	} else if (typeof data.expiresAt === 'number') {
		expiresAt = data.expiresAt;
	} else {
		// Fallback: set to now (caller can treat as no-expiry info)
		expiresAt = Date.now();
	}

	const authContext: IAuthContext = {
		user,
		access_token: data.access_token,
		token_type: data.token_type ?? 'bearer',
		expiresAt
	};

	return authContext;
}
