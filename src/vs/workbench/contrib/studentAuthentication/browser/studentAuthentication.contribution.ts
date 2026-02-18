/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { runWhenGlobalIdle } from '../../../../base/common/async.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IStudentAuthService, AuthState } from '../common/studentAuth.js';
import { showStudentLoginOverlay } from './studentLoginOverlay.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { MenuRegistry, MenuId } from '../../../../platform/actions/common/actions.js';
import { StudentAuthService } from './studentAuthService.js';

// Commands for sign-in / sign-out
export const STUDENT_SIGN_IN_COMMAND_ID = 'student.signIn';
export const STUDENT_SIGN_OUT_COMMAND_ID = 'student.signOut';
export const STUDENT_PERFORM_LOGIN_COMMAND_ID = 'studentLogin.performLogin';

/**
 * Workbench contribution that handles authentication at startup.
 * This runs early in the workbench lifecycle to ensure authentication
 * is resolved before features try to load.
 */
class StudentAuthStartupContribution implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.studentAuthStartup';

	constructor(
		@IStudentAuthService private readonly authService: IStudentAuthService,
		@ICommandService private readonly commandService: ICommandService,
		@IContextKeyService private readonly contextkeyService: IContextKeyService
	) {
		this.initialize();
	}

	private async initialize(): Promise<void> {
		// Wait for auth service to first initialize
		await this.authService.whenReady();

		// set context key for auth state
		this.updateAuthContext(this.authService.state);

		// Listen for auth state changes
		this.authService.onDidAuthStateChange(state => {
			this.updateAuthContext(state);
		});

		// if unauthenticated, show login after the workbench has painted
		if (this.authService.state === AuthState.Unauthenticated) {
			runWhenGlobalIdle(() => {
				this.commandService.executeCommand(STUDENT_SIGN_IN_COMMAND_ID);
			}, 100);
		}
	}

	private updateAuthContext(state: AuthState): void {
		const isAuthenticated = state === AuthState.Authenticated;
		this.contextkeyService.createKey('studentAuthenticated', isAuthenticated);
	}
}

// Register the startup contribution to run before the workbench is fully restored
// This ensures auth is resolved early in the boot process
registerWorkbenchContribution2(
	StudentAuthStartupContribution.ID,
	StudentAuthStartupContribution,
	WorkbenchPhase.AfterRestored
);

/**
 * Command to show the login overlay
 */
CommandsRegistry.registerCommand(STUDENT_SIGN_IN_COMMAND_ID, async accessor => {
	const commandService = accessor.get(ICommandService);
	const contextViewService = accessor.get(IContextViewService);
	showStudentLoginOverlay(commandService, contextViewService);
});

/**
 * Command to perform the actual login (called by the login overlay)
 */
CommandsRegistry.registerCommand(STUDENT_PERFORM_LOGIN_COMMAND_ID, async (accessor, args: { email: string; password: string }) => {
	const authService = accessor.get(IStudentAuthService);

	const email = args?.email ?? '';
	const password = args?.password ?? '';

	if (!email || !password) {
		throw new Error('Email and password are required');
	}

	// Perform login via the auth service
	const authContext = await authService.login(email, password);

	console.log('[StudentAuth] Login successful, auth context ready');

	return authContext;
});

/**
 * Command to logout
 */
CommandsRegistry.registerCommand(STUDENT_SIGN_OUT_COMMAND_ID, async accessor => {
	const authService = accessor.get(IStudentAuthService);
	await authService.logout();
	console.log('[StudentAuth] Logout complete');
});

console.log('[StudentAuth] Registering authentication service and contributions');

// Register Student Auth Service as a singleton (required for all auth-dependent contributions)
registerSingleton(IStudentAuthService, StudentAuthService, InstantiationType.Eager);

// Surface commands in the Command Palette
MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: STUDENT_SIGN_IN_COMMAND_ID,
		title: localize2('studentSignIn', 'Student: Sign In')
	}
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: STUDENT_SIGN_OUT_COMMAND_ID,
		title: localize2('studentSignOut', 'Student: Sign Out')
	}
});

// Sign In button in title bar (when unauthenticated)
MenuRegistry.appendMenuItem(MenuId.TitleBar, {
	command: {
		id: STUDENT_SIGN_IN_COMMAND_ID,
		title: localize2('studentSignInTitleBar', 'Sign In')
	},
	group: 'navigation',
	order: 1,
	when: ContextKeyExpr.not('studentAuthenticated')
});

// Log Out button in title bar (when authenticated)
MenuRegistry.appendMenuItem(MenuId.TitleBar, {
	command: {
		id: STUDENT_SIGN_OUT_COMMAND_ID,
		title: localize2('studentSignOutTitleBar', 'Sign Out')
	},
	group: 'navigation',
	order: 2,
	when: ContextKeyExpr.has('studentAuthenticated')
});

// Sign In in Command Center (when unauthenticated)
MenuRegistry.appendMenuItem(MenuId.CommandCenter, {
	command: {
		id: STUDENT_SIGN_IN_COMMAND_ID,
		title: localize2('studentSignInTitleBar', 'Sign In')
	},
	order: 1,
	when: ContextKeyExpr.not('studentAuthenticated')
});

// Log Out in Command Center (when authenticated)
MenuRegistry.appendMenuItem(MenuId.CommandCenter, {
	command: {
		id: STUDENT_SIGN_OUT_COMMAND_ID,
		title: localize2('studentSignOutTitleBar', 'Sign Out')
	},
	order: 2,
	when: ContextKeyExpr.has('studentAuthenticated')
});

console.log('[StudentAuth] Authentication contribution registered successfully');
