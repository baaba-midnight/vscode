/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
// import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { MenuRegistry, MenuId } from '../../../../platform/actions/common/actions.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { showStudentLoginOverlay } from './studentLoginOverlay.js';
import { IStudentAuthService, AuthState } from '../common/studentAuth.js';
import { StudentAuthService } from './studentAuthService.js';

console.log('[StudentAuth] Registering authentication service and contributions');

// Register Student Auth Service as a singleton
registerSingleton(IStudentAuthService, StudentAuthService, InstantiationType.Eager);

// Commands for sign-in / sign-out
export const STUDENT_SIGN_IN_COMMAND_ID = 'student.signIn';
export const STUDENT_SIGN_OUT_COMMAND_ID = 'student.signOut';
export const STUDENT_PERFORM_LOGIN_COMMAND_ID = 'studentLogin.performLogin';

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

/**
 * Workbench contribution that handles authentication at startup.
 * This runs early in the workbench lifecycle to ensure authentication
 * is resolved before features try to load.
 */
class StudentAuthStartupContribution implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.studentAuthStartup';

	constructor(
		@IStudentAuthService private readonly authService: IStudentAuthService,
		@ICommandService private readonly commandService: ICommandService
	) {
		this.init();
	}

	private async init(): Promise<void> {
		console.log('[StudentAuth] Startup contribution initializing...');

		// Wait for auth service to be ready
		await this.authService.whenReady();

		// If not authenticated, show login modal
		if (this.authService.state === AuthState.Unauthenticated) {
			console.log('[StudentAuth] No valid authentication, showing login...');
			await this.commandService.executeCommand(STUDENT_SIGN_IN_COMMAND_ID);
		} else {
			console.log('[StudentAuth] Already authenticated');
		}

		// Listen for auth state changes
		this.authService.onDidAuthStateChange(state => {
			console.log('[StudentAuth] Auth state changed:', state);

			// If user becomes unauthenticated while IDE is running, show login
			if (state === AuthState.Unauthenticated) {
				this.commandService.executeCommand(STUDENT_SIGN_IN_COMMAND_ID);
			}
		});
	}
}

// Register the startup contribution to run before the workbench is fully restored
// This ensures auth is resolved early in the boot process
registerWorkbenchContribution2(
	StudentAuthStartupContribution.ID,
	StudentAuthStartupContribution,
	WorkbenchPhase.BlockStartup
);

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

console.log('[StudentAuth] Authentication contribution registered successfully');
