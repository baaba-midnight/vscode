/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../../workbench/common/contributions.js';
import { LifecyclePhase } from '../../../../workbench/services/lifecycle/common/lifecycle.js';
import { StudentAssignmentsViewPaneContainer, StudentAssignmentsView, StudentAssignmentsWorkbenchContribution, STUDENT_ASSIGNMENTS_VIEW_CONTAINER_ID } from './studentAssignmentsView.js';
import { IStudentAssignmentsService, StudentAssignmentsService } from '../common/studentAssignmentsService.js';
import { ViewContainer, IViewContainersRegistry, Extensions as ViewContainerExtensions, ViewContainerLocation, IViewsRegistry } from '../../../../workbench/common/views.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../../workbench/browser/editor.js';
import { EditorExtensions } from '../../../../workbench/common/editor.js';
import { CourseDetailEditor } from './courseDetailEditor.js';
import { CourseDetailInput } from './courseDetailInput.js';
import { AssignmentDetailInput } from './assignmentDetailInput.js';

// Register the service
registerSingleton(IStudentAssignmentsService, StudentAssignmentsService, InstantiationType.Delayed);

// Create the view container for Activity Bar
const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: STUDENT_ASSIGNMENTS_VIEW_CONTAINER_ID,
	title: localize2('studentAssignments', "Assignments"),
	icon: ThemeIcon.fromId('codicon codicon-book'),
	order: 5,
	ctorDescriptor: new SyncDescriptor(StudentAssignmentsViewPaneContainer),
	storageId: 'workbench.view.studentAssignments.state',
	hideIfEmpty: false
}, ViewContainerLocation.Sidebar);

// Register the tree view within the container
const viewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);

viewsRegistry.registerViews([{
	id: StudentAssignmentsView.ID,
	name: localize2('courses', "My Courses"),
	containerIcon: ThemeIcon.fromId('codicon codicon-book'),
	canToggleVisibility: false,
	canMoveView: false,
	ctorDescriptor: new SyncDescriptor(StudentAssignmentsView),
	weight: 100
}], VIEW_CONTAINER);

// Register workbench contribution
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(StudentAssignmentsWorkbenchContribution, LifecyclePhase.Restored);

// Register the course detail editor
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		CourseDetailEditor,
		CourseDetailEditor.ID,
		localize('courseDetailEditor', "Course Details")
	),
	[
		new SyncDescriptor(CourseDetailInput),
		new SyncDescriptor(AssignmentDetailInput)
	]
);
