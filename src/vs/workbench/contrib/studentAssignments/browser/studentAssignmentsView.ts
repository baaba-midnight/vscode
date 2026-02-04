/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/studentAssignments.css';

import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { ViewPane, IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { append, $ } from '../../../../base/browser/dom.js';
import { WorkbenchAsyncDataTree } from '../../../../platform/list/browser/listService.js';
import { IListVirtualDelegate } from '../../../../base/browser/ui/list/list.js';
import { IAsyncDataSource, ITreeNode, ITreeRenderer } from '../../../../base/browser/ui/tree/tree.js';
import { FuzzyScore } from '../../../../base/common/filters.js';
import { IStudentAssignmentsService, ICourse, CourseStatus } from '../common/studentAssignmentsService.js';
import { localize } from '../../../../nls.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { CourseDetailInput } from './courseDetailInput.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';

export const STUDENT_ASSIGNMENTS_VIEW_CONTAINER_ID = 'workbench.view.studentAssignments';

interface ICourseCategory {
	kind: 'category';
	id: string;
	label: string;
	status: CourseStatus;
}

type StudentAssignmentsTreeElement = ICourseCategory | ICourse;

function isCategory(element: StudentAssignmentsTreeElement): element is ICourseCategory {
	return (element as ICourseCategory).kind === 'category';
}

class StudentAssignmentsTreeDelegate implements IListVirtualDelegate<StudentAssignmentsTreeElement> {
	getHeight(element: StudentAssignmentsTreeElement): number {
		return isCategory(element) ? 22 : 44;
	}

	getTemplateId(element: StudentAssignmentsTreeElement): string {
		return isCategory(element) ? StudentAssignmentsCategoryRenderer.TEMPLATE_ID : StudentAssignmentsCourseRenderer.TEMPLATE_ID;
	}
}

class StudentAssignmentsCategoryRenderer implements ITreeRenderer<ICourseCategory, FuzzyScore, HTMLSpanElement> {
	static readonly TEMPLATE_ID = 'studentAssignments.category';

	get templateId(): string {
		return StudentAssignmentsCategoryRenderer.TEMPLATE_ID;
	}

	renderTemplate(container: HTMLElement): HTMLSpanElement {
		container.classList.add('category-tree-item');
		const label = document.createElement('span');
		container.appendChild(label);
		return label;
	}

	renderElement(node: ITreeNode<ICourseCategory, FuzzyScore>, _index: number, template: HTMLSpanElement): void {
		template.textContent = node.element.label;
	}

	disposeTemplate(_template: HTMLSpanElement): void {
		// no-op
	}
}

interface ICourseTemplateData {
	readonly container: HTMLElement;
	readonly title: HTMLElement;
	readonly description: HTMLElement;
}

class StudentAssignmentsCourseRenderer implements ITreeRenderer<ICourse, FuzzyScore, ICourseTemplateData> {
	static readonly TEMPLATE_ID = 'studentAssignments.course';

	get templateId(): string {
		return StudentAssignmentsCourseRenderer.TEMPLATE_ID;
	}

	renderTemplate(container: HTMLElement): ICourseTemplateData {
		container.classList.add('course-tree-item');
		const icon = document.createElement('span');
		icon.classList.add('course-icon');
		icon.textContent = '';
		const content = document.createElement('div');
		content.classList.add('course-content');
		const title = document.createElement('div');
		title.classList.add('course-title');
		const description = document.createElement('div');
		description.classList.add('course-description');
		content.appendChild(title);
		content.appendChild(description);
		container.appendChild(icon);
		container.appendChild(content);
		return { container, title, description };
	}

	renderElement(node: ITreeNode<ICourse, FuzzyScore>, _index: number, templateData: ICourseTemplateData): void {
		const course = node.element;
		templateData.title.textContent = course.name;
		templateData.description.textContent = course.description || `${course.instructor} - ${course.term}`;
	}

	disposeTemplate(_template: ICourseTemplateData): void {
		// no-op
	}
}

class StudentAssignmentsDataSource implements IAsyncDataSource<'root', StudentAssignmentsTreeElement> {
	constructor(
		@IStudentAssignmentsService private readonly assignmentsService: IStudentAssignmentsService,
	) { }

	hasChildren(element: 'root' | StudentAssignmentsTreeElement): boolean {
		if (element === 'root') {
			return true;
		}
		if (isCategory(element)) {
			return true;
		}
		return false;
	}

	async getChildren(element: 'root' | StudentAssignmentsTreeElement): Promise<StudentAssignmentsTreeElement[]> {
		const courses = await this.assignmentsService.getCourses();
		if (element === 'root') {
			const categories: ICourseCategory[] = [];
			const definitions: { status: CourseStatus; label: string }[] = [
				{ status: CourseStatus.Active, label: 'Active Courses' },
				{ status: CourseStatus.Completed, label: 'Completed Courses' },
				{ status: CourseStatus.Archived, label: 'Archived Courses' },
			];
			for (const def of definitions) {
				if (courses.some(c => c.status === def.status)) {
					categories.push({ kind: 'category', id: `category-${def.status}`, label: def.label, status: def.status });
				}
			}
			return categories;
		}
		if (isCategory(element)) {
			return courses.filter(c => c.status === element.status);
		}
		return [];
	}
}

export class StudentAssignmentsViewPaneContainer extends ViewPaneContainer {
	constructor(
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExtensionService extensionService: IExtensionService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@ILogService logService: ILogService,
	) {
		super(STUDENT_ASSIGNMENTS_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }, instantiationService, configurationService, layoutService, contextMenuService, telemetryService, extensionService, themeService, storageService, contextService, viewDescriptorService, logService);
	}

	override create(parent: HTMLElement): void {
		super.create(parent);
		parent.classList.add('student-assignments-viewlet');
	}

	override getOptimalWidth(): number {
		return 400;
	}
}

export class StudentAssignmentsView extends ViewPane {
	static readonly ID = 'workbench.view.studentAssignments.courses';

	private tree!: WorkbenchAsyncDataTree<'root', StudentAssignmentsTreeElement, FuzzyScore>;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IStudentAssignmentsService private readonly assignmentsService: IStudentAssignmentsService,
		@IOpenerService openerService: IOpenerService,
		@IHoverService hoverService: IHoverService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.classList.add('student-assignments-view');
		const treeContainer = append(container, $('.student-assignments-tree'));

		this.tree = this._register(this.instantiationService.createInstance(
			WorkbenchAsyncDataTree<'root', StudentAssignmentsTreeElement, FuzzyScore>,
			'StudentAssignmentsTree',
			treeContainer,
			new StudentAssignmentsTreeDelegate(),
			[
				new StudentAssignmentsCategoryRenderer(),
				new StudentAssignmentsCourseRenderer()
			],
			this.instantiationService.createInstance(StudentAssignmentsDataSource),
			{
				accessibilityProvider: {
					getAriaLabel: (element: StudentAssignmentsTreeElement): string => {
						if (isCategory(element)) {
							return element.label;
						}
						return element.name;
					},
					getWidgetAriaLabel: () => localize('studentAssignmentsTree', "Assignments - Courses"),
				}
			}
		));

		this.tree.setInput('root');

		this._register(this.assignmentsService.onDidChangeCourses(() => {
			this.tree.updateChildren();
		}));

		this._register(this.tree.onDidOpen(e => {
			const element = e.element;
			if (element && !isCategory(element)) {
				this.openCourse(element);
			}
		}));
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.tree.layout(height, width);
	}

	override focus(): void {
		super.focus();
		this.tree.domFocus();
	}

	private openCourse(course: ICourse): void {
		console.log(`OPEN COURSE - ${course.name}`);

		const input = new CourseDetailInput(course);
		this.editorService.openEditor(input, { pinned: true });
	}
}

export class StudentAssignmentsWorkbenchContribution implements IWorkbenchContribution {
	constructor(
		@IStudentAssignmentsService _assignmentsService: IStudentAssignmentsService,
	) {
		// Ensure service is instantiated and ready when workbench is restored.
	}
}
