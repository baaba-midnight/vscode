/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IViewsRegistry, Extensions as ViewExtensions, IViewContainersRegistry, Extensions as ViewContainerExtensions, ViewContainerLocation } from '../../../common/views.js';
import { StudentChatPanel } from './studentChatPanel.js';
import { StudentAssignmentPanel } from './studentAssignmentPanel.js';
import { IStudentService, StudentService } from '../common/studentService.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import './media/student.css';

console.log('[Student] Registering student service and UI contributions');

// Register Student Service as a singleton
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

console.log('[Student] View container registered');

// Register Student views (Assignment + Chat) in the Student container
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([
	{
		id: 'workbench.view.student.assignments',
		name: localize2('studentAssignments', 'Assignment'),
		ctorDescriptor: new SyncDescriptor(StudentAssignmentPanel),
		canToggleVisibility: true,
		canMoveView: true,
		weight: 100,
		order: 0,
		when: undefined
	},
	{
		id: 'workbench.view.student.chat',
		name: localize2('studentChat', 'AI Chat'),
		containerIcon: ThemeIcon.fromId('comment-discussion'),
		ctorDescriptor: new SyncDescriptor(StudentChatPanel),
		canToggleVisibility: true,
		canMoveView: true,
		weight: 90,
		order: 1,
		when: undefined
	}
], VIEW_CONTAINER);

console.log('[Student] Student views registered successfully');
