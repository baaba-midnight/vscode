/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { AdaptRequest, AdaptResponse } from './types.js';

export interface IApiResponse<T = unknown> {
	data: T;
	status: number;
	message?: string;
	success?: boolean;
}

export class ApiClient {
	private readonly baseUrl: string;
	private readonly headers: Record<string, string>;
	// private readonly commandService: ICommandService;
	private authToken: string | undefined;

	constructor(baseUrl?: string) {
		this.baseUrl = baseUrl || 'https://capstone-api-t3k3.onrender.com/api';
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

		if (body && !(body instanceof FormData)) {
			headers['Content-Type'] = 'application/json';
		}

		const response = await fetch(url, {
			method,
			headers,
			body: body instanceof FormData ? body : JSON.stringify(body),
		});

		return {
			data: (await response.json()) as T,
			status: response.status,
			success: response.ok,
		};
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

	async adapt(payload: AdaptRequest): Promise<IApiResponse<AdaptResponse>> {
		const response = await this.makeRequest<AdaptResponse>('POST', '/student/adapt', payload);

		const normalizedData =
			response.data && (response.data as { data?: AdaptResponse }).data
				? response
				: response.data;

		return {
			...response,
			data: normalizedData as AdaptResponse
		};
	}

	removeAuthToken(): void {
		delete this.headers['Authorization'];
	}
}
