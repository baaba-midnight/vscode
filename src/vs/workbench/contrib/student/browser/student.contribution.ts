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
import { IStudentService, StudentService } from '../common/studentService.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { ApiClient } from '../common/apiClients.js';
import { loginStudent, STUDENT_AUTH_TOKEN_KEY, STUDENT_AUTH_STUDENT_ID_KEY, STUDENT_AUTH_REFRESH_TOKEN_KEY, hasStoredStudentAuth } from '../common/studentAuth.js';
import { MenuRegistry, MenuId } from '../../../../platform/actions/common/actions.js';
import { showStudentLoginOverlay } from './studentLoginOverlay.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

console.log('[Student] Registering student service and UI contributions');

// Register Student Service as a singleton
registerSingleton(IStudentService, StudentService, InstantiationType.Delayed);

// Commands for explicit sign-in / sign-out
export const STUDENT_SIGN_IN_COMMAND_ID = 'student.signIn';
export const STUDENT_SIGN_OUT_COMMAND_ID = 'student.signOut';
export const STUDENT_PERFORM_LOGIN_COMMAND_ID = 'studentLogin.performLogin';

CommandsRegistry.registerCommand(STUDENT_SIGN_IN_COMMAND_ID, async accessor => {
	const commandService = accessor.get(ICommandService);
	const contextViewService = accessor.get(IContextViewService);
	showStudentLoginOverlay(commandService, contextViewService);
});

CommandsRegistry.registerCommand(STUDENT_PERFORM_LOGIN_COMMAND_ID, async (accessor, args: { email: string; password: string }) => {
	const commandService = accessor.get(ICommandService);
	const secretStorageService = accessor.get(ISecretStorageService);
	const studentService = accessor.get(IStudentService);

	const email = args?.email ?? '';
	const password = args?.password ?? '';

	const apiClient = new ApiClient(commandService);

	const authContext = await loginStudent(commandService, apiClient, email, password);

	// Store auth context in secret storage
	if (authContext.authToken) {
		await secretStorageService.set(STUDENT_AUTH_TOKEN_KEY, authContext.authToken);
	}
	if (authContext.refreshToken) {
		await secretStorageService.set(STUDENT_AUTH_REFRESH_TOKEN_KEY, authContext.refreshToken);
	}
	if (authContext.studentId) {
		await secretStorageService.set(STUDENT_AUTH_STUDENT_ID_KEY, authContext.studentId);
	}

	// preload student data so views are instant
	try {
		await studentService.preloadStudentContext();
	} catch (error) {
		console.log('[Student] Failed to preload student context after login', error);
	}

	return authContext;
});

CommandsRegistry.registerCommand(STUDENT_SIGN_OUT_COMMAND_ID, async accessor => {
	const secretStorageService = accessor.get(ISecretStorageService);
	await secretStorageService.delete(STUDENT_AUTH_TOKEN_KEY);
	await secretStorageService.delete(STUDENT_AUTH_STUDENT_ID_KEY);
	await secretStorageService.delete(STUDENT_AUTH_REFRESH_TOKEN_KEY);
});

class StudentAuthStartupContribution implements IWorkbenchContribution {

	constructor(
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@ICommandService private readonly commandService: ICommandService
	) {
		this.init();
	}

	private async init(): Promise<void> {
		const hasAuth = await hasStoredStudentAuth(this.secretStorageService);
		if (!hasAuth) {
			await this.commandService.executeCommand(STUDENT_SIGN_IN_COMMAND_ID);
		}
	}
}

registerWorkbenchContribution2('workbench.contributions.studentAuthStartup', StudentAuthStartupContribution, WorkbenchPhase.AfterRestored);

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

// Register Student Chat Panel View Container
const VIEW_CONTAINER = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: 'workbench.view.student',
	title: localize2('student', "Student IDE"),
	icon: ThemeIcon.fromId('mortar-board'),
	order: 5,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['workbench.view.student', { mergeViewWithContainerWhenSingleView: true }]),
	storageId: 'workbench.view.student.state',
	hideIfEmpty: false,
}, ViewContainerLocation.Sidebar);

console.log('[Student] View container registered');

// Register Student Chat view in the Student container
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([
	{
		id: 'workbench.view.student.chat',
		name: localize2('studentChat', 'AI Chat'),
		containerIcon: ThemeIcon.fromId('comment-discussion'),
		ctorDescriptor: new SyncDescriptor(StudentChatPanel),
		canToggleVisibility: true,
		canMoveView: true,
		weight: 90,
		order: 0,
		when: undefined
	}
], VIEW_CONTAINER);

console.log('[Student] Student views registered successfully');
