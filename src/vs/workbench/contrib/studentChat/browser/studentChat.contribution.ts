/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/student.css';

import { localize2 } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IViewsRegistry, Extensions as ViewExtensions, IViewContainersRegistry, Extensions as ViewContainerExtensions, ViewContainerLocation } from '../../../common/views.js';
import { StudentChatPanel } from './studentChatPanel.js';
import { IStudentService, StudentService } from '../common/studentChatService.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { Extensions as ConfigExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';

console.log('[StudentChat] Registering student chat service and UI contributions');

// -- Extension Allowlist --------------------------------------------------
// Default curated extensions permitted in student workspaces.
// Institutions can override this list via workspace/user settings.
export const DEFAULT_ALLOWED_EXTENSIONS: readonly string[] = [
	// Language support
	'ms-python.python',               // Python
	'ms-python.vscode-pylance',       // Python language server
	'redhat.java',                    // Java
	'vscjava.vscode-java-pack',       // Java extension pack
	'vscjava.vscode-java-debug',      // Java debugger
	'ms-vscode.cpptools',             // C/C++
	'golang.go',                      // Go
	'rust-lang.rust-analyzer',        // Rust
	// Formatting & linting
	'ms-python.black-formatter',      // Python formatter
	'esbenp.prettier-vscode',         // Prettier
	'dbaeumer.vscode-eslint',         // ESLint
	// Themes & UI (safe, cosmetic only)
	'pkief.material-icon-theme',      // Icons
	'zhuangtongfa.material-theme',    // One Dark Pro
	'github.github-vscode-theme',     // GitHub themes
	// Student tooling
	'ms-vscode.live-server',          // Live preview for web projects
	'formulahendry.code-runner',      // Run code snippets
];

// Register extension allowlist configuration so institutions can customise it
Registry.as<IConfigurationRegistry>(ConfigExtensions.Configuration).registerConfiguration({
	id: 'student',
	title: 'Student',
	properties: {
		'student.extensions.allowlist': {
			type: 'array',
			items: { type: 'string' },
			default: [...DEFAULT_ALLOWED_EXTENSIONS],
			description: 'List of extension IDs that students are permitted to install. Overrides the built-in defaults when set. AI coding assistants (e.g. GitHub Copilot) should not be included.',
			scope: 1 // APPLICATION scope - institution-level setting
		},
		'student.extensions.allowlistMode': {
			type: 'string',
			enum: ['override', 'extend'],
			enumDescriptions: [
				'The configured allowlist replaces the built-in defaults entirely.',
				'The configured allowlist is merged with the built-in defaults.'
			],
			default: 'extend',
			description: 'Controls how a custom allowlist interacts with the built-in defaults.',
			scope: 1
		}
	}
});

// -- Service & View Registration -----------------------------------------

// Register Student Service as a singleton
// Note: Authentication is now handled by the studentAuthentication contribution
registerSingleton(IStudentService, StudentService, InstantiationType.Delayed);

// Register Student Chat Panel View Container
const VIEW_CONTAINER = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: 'workbench.view.student',
	title: localize2('student', "Student Chat"),
	icon: Codicon.commentDiscussion,
	order: 5,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['workbench.view.student', { mergeViewWithContainerWhenSingleView: true }]),
	storageId: 'workbench.view.student.state',
	hideIfEmpty: false,
}, ViewContainerLocation.Sidebar);

console.log('[StudentChat] View container registered');

// Register Student Chat view in the Student container
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([
	{
		id: 'workbench.view.student.chat',
		name: localize2('studentChat', 'AI Chat'),
		containerIcon: Codicon.commentDiscussion,
		ctorDescriptor: new SyncDescriptor(StudentChatPanel),
		canToggleVisibility: true,
		canMoveView: true,
		weight: 90,
		order: 0,
		when: ContextKeyExpr.has('studentAuthenticated')
	}
], VIEW_CONTAINER);

console.log('[StudentChat] Student chat views registered successfully');
