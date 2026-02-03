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
	studentId?: string;
}

const STUDENT_AUTH_TOKEN_KEY = 'student.ide.authToken';
const STUDENT_AUTH_STUDENT_ID_KEY = 'student.ide.studentId';

export async function loginStudent(
	commandService: ICommandService,
	apiClient: ApiClient,
	email: string,
	password: string
): Promise<IStudentAuthContext> {
	const response = await apiClient.post<{ access_token?: string; user?: { user_id?: string;[key: string]: unknown };[key: string]: unknown }>(
		'/users/login',
		{ email, password }
	);

	if (!response.success) {
		throw new Error(`Login failed with status ${response.status}`);
	}

	const token = response.data?.access_token as string | undefined;
	const studentId = response.data?.user?.user_id as string | undefined;

	apiClient.setAuthToken(token);

	return { apiClient, authToken: token, studentId };
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
	// Always prompt for credentials (loop until success or user cancels)
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
