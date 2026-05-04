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
import { append, $, clearNode, getContentHeight, getContentWidth, getWindow, scheduleAtNextAnimationFrame } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { WorkbenchAsyncDataTree } from '../../../../platform/list/browser/listService.js';
import { IListVirtualDelegate } from '../../../../base/browser/ui/list/list.js';
import { IAsyncDataSource, ITreeNode, ITreeRenderer } from '../../../../base/browser/ui/tree/tree.js';
import { FuzzyScore } from '../../../../base/common/filters.js';
import { IStudentAssignmentsService, ICourse, CourseStatus } from '../common/studentAssignmentsService.js';
import { localize } from '../../../../nls.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { CourseDetailInput } from './courseDetailInput.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IStudentAuthService, AuthState } from '../../studentAuthentication/common/studentAuth.js';

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
		// Sidebar shows only the course name; details are in the editor view.
		templateData.title.textContent = course.name;
		// No secondary description line.
		templateData.description.textContent = '';
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
	private bodyContainer!: HTMLElement;
	private treeCreationPending = false;
	private _lastLayoutHeight = 0;
	private _lastLayoutWidth = 0;

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
		@ICommandService _commandService: ICommandService,
		@IStudentAuthService private readonly authService: IStudentAuthService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		// Listen for auth state changes
		this._register(this.authService.onDidAuthStateChange(state => {
			console.log('[StudentAssignments] Auth state changed:', state);
			if (state === AuthState.Authenticated) {
				// Reload view when user logs in
				this.refreshView();
			} else if (state === AuthState.Unauthenticated) {
				// Show login prompt when user logs out
				this.showLoginPrompt();
			}
		}));

		// React to course data changes so the view updates as soon as
		// courses are fetched, even if that happens after the initial
		// render.
		this._register(this.assignmentsService.onDidChangeCourses(() => {
			if (this.tree) {
				this.tree.updateChildren();
			} else if (this.bodyContainer) {
				this.createTree();
			} else {
				// bodyContainer not set yet, defer tree creation
				this.treeCreationPending = true;
			}
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.classList.add('student-assignments-view');
		this.bodyContainer = append(container, $('.student-assignments-root'));
		void this.initialize();
		// If tree creation was deferred because bodyContainer wasn't set, do it now
		if (this.treeCreationPending) {
			this.treeCreationPending = false;
			this.createTree();
		}
	}

	private async initialize(): Promise<void> {
		console.log('[StudentAssignments] Initializing view...');

		// Wait for auth service to be ready
		await this.authService.whenReady();

		// Check if authenticated
		if (this.authService.state !== AuthState.Authenticated) {
			console.log('[StudentAssignments] Not authenticated, showing login prompt');
			this.renderSignInPrompt();
			return;
		}

		console.log('[StudentAssignments] Authenticated, loading courses...');

		// Show a lightweight loading state while courses are being fetched
		this.renderLoadingState();

		// Load courses
		const courses = await this.assignmentsService.getCourses();

		// Only create the tree if bodyContainer is set
		if (courses.length > 0 && !this.tree && this.bodyContainer) {
			this.createTree();
		}
	}

	private createTree(): void {
		// Clear any previous state (e.g., loading or empty messages)
		clearNode(this.bodyContainer);
		const treeContainer = append(this.bodyContainer, $('.student-assignments-tree'));
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

		// Tree is created asynchronously after data loads; layoutBody may have already run.
		// Apply stored dimensions so the tree renders immediately without toggling the view.
		if (this._lastLayoutHeight > 0 && this._lastLayoutWidth > 0) {
			this.tree.layout(this._lastLayoutHeight, this._lastLayoutWidth);
		} else {
			// Fallback: layout hasn't run yet (e.g. view was hidden). Schedule layout on next frame.
			this._register(scheduleAtNextAnimationFrame(getWindow(this.bodyContainer), () => {
				if (this.tree) {
					const h = getContentHeight(this.bodyContainer);
					const w = getContentWidth(this.bodyContainer);
					if (h > 0 && w > 0) {
						this.tree.layout(h, w);
					}
				}
			}));
		}

		this._register(this.tree.onDidOpen(e => {
			const element = e.element;
			if (element && !isCategory(element)) {
				this.openCourse(element);
			}
		}));
	}

	private renderSignInPrompt(): void {
		// Clear existing content
		clearNode(this.bodyContainer);

		const wrapper = append(this.bodyContainer, $('.student-auth-required.empty-state-signed-out'));
		append(wrapper, $('span.empty-state-icon' + ThemeIcon.asCSSSelector(Codicon.book)));
		const message = append(wrapper, $('.student-auth-message'));
		message.textContent = localize('studentAuthRequiredCourses', "Sign in to your school account to view your courses.");
		const hint = append(wrapper, $('.student-auth-hint'));
		hint.textContent = localize('studentAuthHint', "Not signed in yet");
	}

	// private renderEmptyState(): void {
	// 	// Clear existing content
	// 	clearNode(this.bodyContainer);

	// 	const wrapper = append(this.bodyContainer, $('.empty-state'));
	// 	wrapper.textContent = localize('studentAssignmentsEmptyCourses', "No courses are available yet. Once your courses are set up, they'll appear here.");
	// }

	private renderLoadingState(): void {
		// Clear existing content and show a simple loading indicator
		clearNode(this.bodyContainer);

		const wrapper = append(this.bodyContainer, $('.loading-state'));
		wrapper.textContent = localize('studentAssignmentsLoadingCourses', "Loading your courses...");
	}

	// private renderErrorState(error: unknown): void {
	// 	// Clear existing content
	// 	clearNode(this.bodyContainer);

	// 	const wrapper = append(this.bodyContainer, $('.error-state'));
	// 	const message = append(wrapper, $('.error-message'));
	// 	message.textContent = localize('studentAssignmentsError', "Failed to load courses. Please try again.");

	// 	const errorDetails = append(wrapper, $('.error-details'));
	// 	const errorMessage = error instanceof Error ? error.message : String(error ?? 'Unknown error');
	// 	errorDetails.textContent = errorMessage;

	// 	const button = append(wrapper, $('button.retry-button')) as HTMLButtonElement;
	// 	button.textContent = localize('studentAssignmentsRetry', "Retry");
	// 	button.addEventListener('click', () => {
	// 		this.refreshView();
	// 	});
	// }

	private showLoginPrompt(): void {
		// Clear existing content and show login prompt
		clearNode(this.bodyContainer);
		this.renderSignInPrompt();
	}

	private async refreshView(): Promise<void> {
		console.log('[StudentAssignments] Refreshing view...');
		clearNode(this.bodyContainer);
		await this.initialize();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this._lastLayoutHeight = height;
		this._lastLayoutWidth = width;
		if (this.tree) {
			this.tree.layout(height, width);
		}
	}

	override focus(): void {
		super.focus();
		if (this.tree) {
			this.tree.domFocus();
		}
	}

	private openCourse(course: ICourse): void {
		console.log(`[StudentAssignments] Opening course: ${course.name}`);

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
