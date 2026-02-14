/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { ApiClient } from './apiClients.js';

export interface IStudentAuthContext {
	apiClient: ApiClient;
	authToken?: string;
	refreshToken?: string;
	studentId?: string;
}

export const STUDENT_AUTH_TOKEN_KEY = 'student.ide.authToken';
export const STUDENT_AUTH_STUDENT_ID_KEY = 'student.ide.studentId';
export const STUDENT_AUTH_REFRESH_TOKEN_KEY = 'student.ide.refreshToken';

export async function hasStoredStudentAuth(secretStorageService: ISecretStorageService): Promise<boolean> {
	const token = await secretStorageService.get(STUDENT_AUTH_TOKEN_KEY);
	return !!token;
}

export async function loginStudent(
	commandService: ICommandService,
	apiClient: ApiClient,
	email: string,
	password: string
): Promise<IStudentAuthContext> {
	const response = await apiClient.post<{ access_token?: string; refresh_token?: string; user?: { user_id?: string;[key: string]: unknown };[key: string]: unknown }>(
		'/users/login',
		{ email, password }
	);

	if (!response.success) {
		throw new Error(`Login failed with status ${response.status}`);
	}

	const access_token = response.data?.access_token as string | undefined;
	const refresh_token = response.data?.refresh_token as string | undefined;
	const studentId = response.data?.user?.user_id as string | undefined;

	apiClient.setAuthToken(access_token);

	if (!access_token) {
		throw new Error('Login response did not include an access token');
	}

	return { apiClient, authToken: access_token, refreshToken: refresh_token, studentId };
}

/**
 * High-level helper:
 * 1. Try to restore existing session from secret storage (auto-login).
 * 2. If none, prompt for email/password and log in (with retry on failure).
 */
export async function ensureStudentAuth(
	quickInputService: IQuickInputService,
	commandService: ICommandService,
	apiClient: ApiClient,
	secretStorageService: ISecretStorageService
): Promise<IStudentAuthContext | undefined> {
	// 1. Try to restore existing session from secret storage (auto-login)
	try {
		const storedToken = await secretStorageService.get(STUDENT_AUTH_TOKEN_KEY);
		const storedStudentId = await secretStorageService.get(STUDENT_AUTH_STUDENT_ID_KEY);
		const storedRefreshToken = await secretStorageService.get(STUDENT_AUTH_REFRESH_TOKEN_KEY);
		if (storedToken) {
			apiClient.setAuthToken(storedToken);
			return {
				apiClient,
				authToken: storedToken,
				refreshToken: storedRefreshToken ?? undefined,
				studentId: storedStudentId ?? undefined
			};
		}
	} catch (error) {
		console.error('Failed to restore student auth from storage:', error);
	}

	// 2. If none, prompt for email/password and log in (with retry on failure)
	while (true) {
		const email = await quickInputService.input({
			prompt: 'Student email',
			placeHolder: 'student@example.com'
		});
		if (!email) {
			return;
		}

		const password = await quickInputService.input({
			prompt: 'Password',
			password: true
		});
		if (!password) {
			return;
		}

		try {
			const authContext = await loginStudent(commandService, apiClient, email, password);
			if (authContext.authToken) {
				await secretStorageService.set(STUDENT_AUTH_TOKEN_KEY, authContext.authToken);
			}
			if (authContext.refreshToken) {
				await secretStorageService.set(STUDENT_AUTH_REFRESH_TOKEN_KEY, authContext.refreshToken);
			}
			if (authContext.studentId) {
				await secretStorageService.set(STUDENT_AUTH_STUDENT_ID_KEY, authContext.studentId);
			}
			return authContext;
		} catch (error) {
			// Login failed, loop again so the student can retry or cancel.
			console.error('Student login failed:', error);
		}
	}
}

export async function promptAndLoginStudent(
	quickInputService: IQuickInputService,
	commandService: ICommandService
): Promise<IStudentAuthContext | undefined> {
	const email = await quickInputService.input({
		prompt: 'Student email',
		placeHolder: 'student@example.com'
	});
	if (!email) {
		return;
	}

	const password = await quickInputService.input({
		prompt: 'Password',
		password: true
	});
	if (!password) {
		return;
	}

	const apiClient = new ApiClient(commandService);
	return loginStudent(commandService, apiClient, email, password);
}

/**
 * Attempt to refresh the student's access token using a stored refresh token.
 *
 * This expects the backend to expose a `/users/refresh` endpoint that accepts
 * `{ refresh_token }` and returns the same shape as `/users/login`:
 * `{ access_token, refresh_token, user: { user_id } }`.
 */
export async function refreshStudentAuth(
	commandService: ICommandService,
	apiClient: ApiClient,
	secretStorageService: ISecretStorageService
): Promise<IStudentAuthContext | undefined> {
	try {
		const storedRefreshToken = await secretStorageService.get(STUDENT_AUTH_REFRESH_TOKEN_KEY);
		if (!storedRefreshToken) {
			return;
		}

		// Call backend to exchange refresh token for a new access token.
		// The backend is responsible for talking to Supabase (or other IdP).
		const response = await apiClient.post<{
			access_token?: string;
			refresh_token?: string;
			user?: { user_id?: string;[key: string]: unknown };
			[key: string]: unknown;
		}>('/users/refresh', { refresh_token: storedRefreshToken });

		if (!response.success) {
			// Refresh failed; clear stored credentials so the next call can re-auth.
			await secretStorageService.delete(STUDENT_AUTH_TOKEN_KEY);
			await secretStorageService.delete(STUDENT_AUTH_STUDENT_ID_KEY);
			await secretStorageService.delete(STUDENT_AUTH_REFRESH_TOKEN_KEY);
			return;
		}

		const access_token = response.data?.access_token as string | undefined;
		const newRefreshToken = response.data?.refresh_token as string | undefined;
		const studentId = response.data?.user?.user_id as string | undefined;

		if (!access_token) {
			throw new Error('Refresh response did not include an access token');
		}

		apiClient.setAuthToken(access_token);
		await secretStorageService.set(STUDENT_AUTH_TOKEN_KEY, access_token);
		if (newRefreshToken) {
			await secretStorageService.set(STUDENT_AUTH_REFRESH_TOKEN_KEY, newRefreshToken);
		}
		if (studentId) {
			await secretStorageService.set(STUDENT_AUTH_STUDENT_ID_KEY, studentId);
		}

		return {
			apiClient,
			authToken: access_token,
			refreshToken: newRefreshToken ?? storedRefreshToken,
			studentId
		};
	} catch (error) {
		console.error('Failed to refresh student auth:', error);
		return;
	}
}
