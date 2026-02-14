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
import { ThemeIcon } from '../../../../base/common/themables.js';

console.log('[StudentChat] Registering student chat service and UI contributions');

// Register Student Service as a singleton
// Note: Authentication is now handled by the studentAuthentication contribution
registerSingleton(IStudentService, StudentService, InstantiationType.Delayed);

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

console.log('[StudentChat] View container registered');

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

console.log('[StudentChat] Student chat views registered successfully');
