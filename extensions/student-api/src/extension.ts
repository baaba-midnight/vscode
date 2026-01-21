/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
// import fetch from 'node-fetch';

interface ApiResponse {
	status: number;
	ok: boolean;
	data: string | object;
}

export function activate(context: vscode.ExtensionContext): void {
	// Register a command that performs HTTP requests from Extension Host (Node.js)
	const disposable = vscode.commands.registerCommand(
		'student.api.request',
		async (method: string, url: string, body?: object, headers?: Record<string, string>): Promise<ApiResponse> => {
			try {
				const response = await fetch(url, {
					method,
					headers: {
						'Content-Type': 'application/json',
						'Accept': 'application/json',
						...headers
					},
					body: body ? JSON.stringify(body) : undefined
				});

				const contentType = response.headers.get('content-type') || '';
				let data: string | object;

				if (contentType.includes('application/json')) {
					data = await response.json() as object;
				} else {
					data = await response.text();
				}

				return {
					status: response.status,
					ok: response.ok,
					data
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(`API request failed: ${message}`);
			}
		}
	);

	context.subscriptions.push(disposable);
}

export function deactivate(): void { }
