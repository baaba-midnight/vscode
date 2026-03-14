/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { RawContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as ConfigExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { DEFAULT_ALLOWED_EXTENSIONS, STUDENT_ALLOWLIST_MODE_SETTING, STUDENT_ALLOWLIST_SETTING } from '../common/defaults.js';
import { IStudentPolicyService } from '../common/studentPolicy.js';
import { StudentPolicyService } from '../common/studentPolicyService.js';

console.log('[StudentPolicy] Registering student policy service and configuration');

Registry.as<IConfigurationRegistry>(ConfigExtensions.Configuration).registerConfiguration({
	id: 'student',
	title: localize2('studentPolicy', 'Student').value,
	properties: {
		[STUDENT_ALLOWLIST_SETTING]: {
			type: 'array',
			items: { type: 'string' },
			default: [...DEFAULT_ALLOWED_EXTENSIONS],
			description: 'List of extension IDs that students are permitted to install. Overrides the built-in defaults when set. AI coding assistants (e.g. GitHub Copilot) should not be included.',
			scope: 1
		},
		[STUDENT_ALLOWLIST_MODE_SETTING]: {
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

registerSingleton(IStudentPolicyService, StudentPolicyService, InstantiationType.Delayed);

const StudentModeContext = new RawContextKey<boolean>('studentMode', false);

class StudentModeContextContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.studentModeContext';

	private readonly studentModeContextKey = StudentModeContext.bindTo(this.contextKeyService);

	constructor(
		@IStudentPolicyService private readonly studentPolicyService: IStudentPolicyService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
	) {
		super();

		this.updateStudentModeContext();

		this._register(this.studentPolicyService.onDidChangePolicy(() => {
			this.updateStudentModeContext();
		}));
	}

	private updateStudentModeContext(): void {
		this.studentModeContextKey.set(this.studentPolicyService.isStudentModeEnabled());
	}
}

registerWorkbenchContribution2(
	StudentModeContextContribution.ID,
	StudentModeContextContribution,
	WorkbenchPhase.BlockStartup
);

console.log('[StudentPolicy] Registration complete');
