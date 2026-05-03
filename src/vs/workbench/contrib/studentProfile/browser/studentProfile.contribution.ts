/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize2 } from '../../../../nls.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { STUDENT_SIGN_IN_COMMAND_ID, STUDENT_SIGN_OUT_COMMAND_ID } from '../../studentAuthentication/browser/studentAuthentication.contribution.js';

const StudentProfileMenu = new MenuId('StudentProfileMenu');

class StudentProfileContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.studentProfile';

	constructor() {
		super();

		this._register(MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
			submenu: StudentProfileMenu,
			group: '9_student',
			order: 1,
			title: localize2('studentProfileMenu', 'Student IDE'),
			when: ContextKeyExpr.equals('studentAuthenticated', true)
		}));

		this._register(MenuRegistry.appendMenuItem(StudentProfileMenu, {
			group: '0_main',
			order: 1,
			command: {
				id: 'workbench.userDataSync.actions.turnOn',
				title: localize2('studentProfileSync', 'Backup and Sync Settings...')
			},
			when: ContextKeyExpr.equals('studentAuthenticated', true)
		}));

		this._register(MenuRegistry.appendMenuItem(StudentProfileMenu, {
			group: '0_main',
			order: 2,
			command: {
				id: STUDENT_SIGN_IN_COMMAND_ID,
				title: localize2('studentProfileSignIn', 'Sign In to Student IDE')
			},
			when: ContextKeyExpr.not('studentAuthenticated')
		}));

		this._register(MenuRegistry.appendMenuItem(StudentProfileMenu, {
			group: '0_main',
			order: 3,
			command: {
				id: STUDENT_SIGN_OUT_COMMAND_ID,
				title: localize2('studentProfileSignOut', 'Sign Out of Student IDE')
			},
			when: ContextKeyExpr.equals('studentAuthenticated', true)
		}));
	}
}

registerWorkbenchContribution2(
	StudentProfileContribution.ID,
	StudentProfileContribution,
	WorkbenchPhase.AfterRestored
);
