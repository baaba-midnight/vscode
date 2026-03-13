/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as ConfigExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
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

console.log('[StudentPolicy] Registration complete');
