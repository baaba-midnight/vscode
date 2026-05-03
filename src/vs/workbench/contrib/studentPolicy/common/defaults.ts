/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const DEFAULT_ALLOWED_EXTENSIONS: readonly string[] = [
	// Language support
	'ms-python.python',
	'ms-python.vscode-pylance',
	'redhat.java',
	'vscjava.vscode-java-pack',
	'vscjava.vscode-java-debug',
	'ms-vscode.cpptools',
	'golang.go',
	'rust-lang.rust-analyzer',
	// Formatting & linting
	'ms-python.black-formatter',
	'esbenp.prettier-vscode',
	'dbaeumer.vscode-eslint',
	// Themes & UI (safe, cosmetic only)
	'pkief.material-icon-theme',
	'zhuangtongfa.material-theme',
	'github.github-vscode-theme',
	// Student tooling
	'ms-vscode.live-server',
	'formulahendry.code-runner',
];

export const STUDENT_ALLOWLIST_SETTING = 'student.extensions.allowlist';
export const STUDENT_ALLOWLIST_MODE_SETTING = 'student.extensions.allowlistMode';
