/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IStudentPolicyService = createDecorator<IStudentPolicyService>('studentPolicyService');

export type StudentAllowlistMode = 'override' | 'extend';

export interface IStudentPolicyService {
	readonly _serviceBrand: undefined;
	readonly onDidChangePolicy: Event<void>;

	isStudentModeEnabled(): boolean;
	getAllowedExtensions(): readonly string[];
	isExtensionAllowed(extensionId: string): boolean;
}
