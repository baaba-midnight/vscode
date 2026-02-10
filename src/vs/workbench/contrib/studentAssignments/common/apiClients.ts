/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICommandService } from '../../../../platform/commands/common/commands.js';

export interface IApiResponse<T = unknown> {
	data: T;
	status: number;
	message?: string;
	success?: boolean;
}

export class ApiClient {
	private readonly baseUrl: string;
	private readonly headers: Record<string, string>;
	private readonly commandService: ICommandService;
	private authToken: string | undefined;

	constructor(commandService: ICommandService, baseUrl?: string) {
		this.commandService = commandService;
		this.baseUrl = baseUrl || 'http://127.0.0.1:8000/api';
		this.headers = {
			'Content-Type': 'application/json',
			'Accept': 'application/json',
		};
	}

	setAuthToken(token: string | undefined): void {
		this.authToken = token;
	}

	private async makeRequest<T>(
		method: 'GET' | 'POST' | 'PUT' | 'DELETE',
		endpoint: string,
		body?: unknown
	): Promise<IApiResponse<T>> {
		const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;

		const headers: Record<string, string> = { ...this.headers };
		if (this.authToken) {
			headers['Authorization'] = `Bearer ${this.authToken}`;
		}

		try {
			// Call the extension host command
			const result = await this.commandService.executeCommand<{ status: number; ok: boolean; data: unknown }>(
				'student.api.request',
				method,
				url,
				body,
				headers
			);
			if (!result) {
				throw new Error('API command not found or failed');
			}

			return {
				data: result.data as T,
				status: result.status,
				success: result.ok,
			};
		} catch (error) {
			console.error('API request error:', error);
			throw error;
		}
	}

	async get<T>(endpoint: string): Promise<IApiResponse<T>> {
		return this.makeRequest<T>('GET', endpoint);
	}

	async post<T>(endpoint: string, body?: unknown): Promise<IApiResponse<T>> {
		return this.makeRequest<T>('POST', endpoint, body);
	}

	async put<T>(endpoint: string, body?: unknown): Promise<IApiResponse<T>> {
		return this.makeRequest<T>('PUT', endpoint, body);
	}

	async delete<T>(endpoint: string): Promise<IApiResponse<T>> {
		return this.makeRequest<T>('DELETE', endpoint);
	}

	removeAuthToken(): void {
		delete this.headers['Authorization'];
	}
}
