/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { ApiClient } from './apiClients.js';

export interface IStudentAuthContext {
	apiClient: ApiClient;
	authToken?: string;
	studentId?: string;
}

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
 * 1. Try to restore existing Supabase session (auto-login).
 * 2. If none, prompt for email/password and log in.
 */
export async function ensureStudentAuth(
	quickInputService: IQuickInputService,
	commandService: ICommandService,
	apiClient: ApiClient
): Promise<IStudentAuthContext | undefined> {
	// Prompt for credentials once; backend handles session/token.
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

	return loginStudent(commandService, apiClient, email, password);
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
