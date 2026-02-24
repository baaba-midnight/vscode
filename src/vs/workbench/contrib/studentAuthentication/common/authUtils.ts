/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStudentAuthService } from './studentAuth.js';

export interface IApiLikeResponse<T = unknown> {
	data?: T;
	status?: number;
	success?: boolean;
}

/**
 * Helper to run an API call and retry once on 401 by invoking `authService.refreshAccessToken()`.
 * The passed function should either return an object with `status`/`success` or throw an error
 * with a `.status` property for network/http errors.
 */
export async function withAuthRetry<T>(authService: IStudentAuthService, fn: () => Promise<IApiLikeResponse<T>>): Promise<IApiLikeResponse<T>> {
	try {
		const r = await fn();
		if (r && (r.status === 401 || r.success === false && r.status === 401)) {
			const refreshed = await authService.refreshAccessToken();
			if (refreshed) {
				return await fn();
			}
		}
		return r;
	} catch (err: unknown) {
		const errStatus = (err as { status?: number } | undefined)?.status;
		if (errStatus === 401) {
			const refreshed = await authService.refreshAccessToken();
			if (refreshed) {
				return await fn();
			}
		}
		throw err;
	}
}
