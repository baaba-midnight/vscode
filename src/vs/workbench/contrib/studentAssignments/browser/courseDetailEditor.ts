/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/studentAssignments.css';
import { EditorPane } from '../../../../workbench/browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { CourseDetailInput } from '../browser/courseDetailInput.js';
import { AssignmentDetailInput } from '../browser/assignmentDetailInput.js';
import { IStudentAssignmentsService, IAssignment, AssignmentStatus, ICourse } from '../common/studentAssignmentsService.js';
import { IEditorService } from '../../../../workbench/services/editor/common/editorService.js';
import { append, $, addDisposableListener, EventType, clearNode, Dimension } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';

/**
 * Editor that displays course details and assignment cards
 * Similar to Extensions editor layout
 */
export class CourseDetailEditor extends EditorPane {
	static readonly ID = 'workbench.editor.courseDetail';

	private container!: HTMLElement;
	private headerContainer!: HTMLElement;
	private assignmentsContainer!: HTMLElement;
	private assignmentsGrid: HTMLElement | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IStudentAssignmentsService private readonly assignmentsService: IStudentAssignmentsService,
		@IEditorService private readonly editorService: IEditorService,
		// @IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super(CourseDetailEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.container = append(parent, $('.course-detail-editor'));

		// Course header section
		this.headerContainer = append(this.container, $('.course-header'));

		// Assignment cards section
		this.assignmentsContainer = append(this.container, $('.assignments-section'));
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		console.log('SET INPUT DONE');

		await super.setInput(input, options, context, token);

		let course: ICourse | undefined;
		let assignments: IAssignment[] = [];

		const asCourseInput = input as CourseDetailInput;
		const asAssignmentInput = input as AssignmentDetailInput;
		if (asCourseInput.course) {
			course = asCourseInput.course;
			assignments = await this.assignmentsService.getAssignmentsByCourse(course.id);
		} else if (asAssignmentInput.assignment) {
			const assignment = asAssignmentInput.assignment;
			course = await this.assignmentsService.getCourse(assignment.courseId);
			if (course) {
				assignments = await this.assignmentsService.getAssignmentsByCourse(course.id);
			}
		}

		if (!course || token.isCancellationRequested) {
			return;
		}

		this.renderCourseHeader(course);
		this.renderAssignments(assignments);
	}

	private renderCourseHeader(course: ICourse): void {
		console.log('[CourseDetailEditor] renderCourseHeader', course.name);

		clearNode(this.headerContainer);

		const header = append(this.headerContainer, $('.header-content'));

		// Course icon/banner
		const banner = append(header, $('.course-banner'));
		banner.style.background = course.color || '#007ACC';

		// Course info
		const info = append(header, $('.course-info'));

		const title = append(info, $('h1.course-title'));
		title.textContent = course.name;

		const meta = append(info, $('.course-meta'));

		const instructor = append(meta, $('.meta-item'));
		instructor.textContent = `Instructor: ${course.instructor}`;

		const term = append(meta, $('.meta-item'));
		term.textContent = `Term: ${course.term}`;

		const assignmentCount = append(meta, $('.meta-item'));
		assignmentCount.textContent = `Assignments: ${course.assignmentCount}`;

		// Course description
		if (course.description) {
			const description = append(info, $('.course-description'));
			description.textContent = course.description;
		}

		// Action buttons
		const actions = append(header, $('.course-actions'));

		const viewFilesBtn = append(actions, $('button.action-button'));
		viewFilesBtn.textContent = 'View Course Files';
		addDisposableListener(viewFilesBtn, EventType.CLICK, () => {
			this.openCourseFiles(course);
		});
	}

	private renderAssignments(assignments: IAssignment[]): void {
		console.log('[CourseDetailEditor] renderAssignments', assignments.length);
		clearNode(this.assignmentsContainer);

		// Section header
		const sectionHeader = append(this.assignmentsContainer, $('.section-header'));
		const title = append(sectionHeader, $('h2'));
		title.textContent = 'Assignments';

		// Filter tabs
		const filterTabs = append(this.assignmentsContainer, $('.filter-tabs'));

		const filters = [
			{ label: 'All', filter: null },
			{ label: 'Not Started', filter: AssignmentStatus.NotStarted },
			{ label: 'In Progress', filter: AssignmentStatus.InProgress },
			{ label: 'Submitted', filter: AssignmentStatus.Submitted },
			{ label: 'Overdue', filter: AssignmentStatus.Overdue }
		];
		const tabs: HTMLElement[] = [];
		filters.forEach((f, index) => {
			const tab = append(filterTabs, $('button.filter-tab'));
			tab.textContent = f.label;
			if (index === 0) {
				tab.classList.add('active');
			}
			tabs.push(tab);
			addDisposableListener(tab, EventType.CLICK, () => {
				// Update active tab
				for (const other of tabs) {
					other.classList.remove('active');
				}
				tab.classList.add('active');

				// Filter assignments
				const filtered = f.filter ? assignments.filter(a => a.status === f.filter) : assignments;
				this.renderAssignmentCards(filtered);
			});
		});

		// Assignment cards grid
		this.renderAssignmentCards(assignments);
	}

	private renderAssignmentCards(assignments: IAssignment[]): void {
		// Remove existing grid if present
		if (this.assignmentsGrid) {
			this.assignmentsGrid.remove();
			this.assignmentsGrid = undefined;
		}

		const grid = append(this.assignmentsContainer, $('.assignments-grid'));
		this.assignmentsGrid = grid;

		if (assignments.length === 0) {
			const empty = append(grid, $('.empty-state'));
			empty.textContent = 'No assignments found';
			return;
		}

		assignments.forEach(assignment => {
			const card = this.createAssignmentCard(assignment);
			append(grid, card);
		});
	}

	private createAssignmentCard(assignment: IAssignment): HTMLElement {
		const card = $('.assignment-card');

		// Status indicator
		const statusBar = append(card, $('.status-bar'));
		statusBar.classList.add(`status-${assignment.status}`);

		// Card header
		const cardHeader = append(card, $('.card-header'));

		const title = append(cardHeader, $('h3.assignment-title'));
		title.textContent = assignment.title;

		const statusBadge = append(cardHeader, $('.status-badge'));
		statusBadge.textContent = this.getStatusLabel(assignment.status);
		statusBadge.classList.add(`status-${assignment.status}`);

		// Card meta
		const meta = append(card, $('.card-meta'));

		const dueDate = append(meta, $('.meta-item'));
		dueDate.textContent = `Due: ${this.formatDate(assignment.dueDate)}`;

		const points = append(meta, $('.meta-item'));
		points.textContent = `${assignment.points} points`;

		const type = append(meta, $('.meta-item'));
		type.textContent = `Type: ${assignment.type}`;

		// Description
		const description = append(card, $('.assignment-description'));
		description.textContent = assignment.description;

		// Card footer with actions
		const footer = append(card, $('.card-footer'));

		const actionsContainer = append(footer, $('.card-actions'));

		if (assignment.status === AssignmentStatus.NotStarted) {
			const startBtn = append(actionsContainer, $('button.btn-primary'));
			startBtn.textContent = 'Start Assignment';
			addDisposableListener(startBtn, EventType.CLICK, (e) => {
				e.stopPropagation();
				this.startAssignment(assignment);
			});
		} else if (assignment.status === AssignmentStatus.InProgress || assignment.status === AssignmentStatus.Overdue) {
			const continueBtn = append(actionsContainer, $('button.btn-secondary'));
			continueBtn.textContent = 'Continue Working';
			addDisposableListener(continueBtn, EventType.CLICK, (e) => {
				e.stopPropagation();
				this.openAssignmentFiles(assignment);
			});

			const submitBtn = append(actionsContainer, $('button.btn-primary'));
			submitBtn.textContent = 'Submit';
			addDisposableListener(submitBtn, EventType.CLICK, (e) => {
				e.stopPropagation();
				this.submitAssignment(assignment);
			});
		} else if (assignment.status === AssignmentStatus.Submitted) {
			const viewBtn = append(actionsContainer, $('button.btn-secondary'));
			viewBtn.textContent = 'View Submission';
			addDisposableListener(viewBtn, EventType.CLICK, (e) => {
				e.stopPropagation();
				this.viewSubmission(assignment);
			});
		}

		// Click card to view details
		addDisposableListener(card, EventType.CLICK, () => {
			this.openAssignmentDetail(assignment);
		});

		return card;
	}

	private getStatusLabel(status: AssignmentStatus): string {
		const labels = {
			[AssignmentStatus.NotStarted]: 'Not Started',
			[AssignmentStatus.InProgress]: 'In Progress',
			[AssignmentStatus.Submitted]: 'Submitted',
			[AssignmentStatus.Overdue]: 'Overdue'
		};
		return labels[status] || 'Unknown';
	}

	private formatDate(date: Date | string): string {
		const d = typeof date === 'string' ? new Date(date) : date;
		const now = new Date();
		const diffDays = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

		if (diffDays === 0) {
			return 'Today';
		}
		if (diffDays === 1) {
			return 'Tomorrow';
		}
		if (diffDays === -1) {
			return 'Yesterday';
		}
		if (diffDays > 0) {
			return `in ${diffDays} days`;
		}
		if (diffDays < 0) {
			return `${Math.abs(diffDays)} days ago`;
		}

		return d.toLocaleDateString();
	}

	private openAssignmentDetail(assignment: IAssignment): void {
		const input = new AssignmentDetailInput(assignment);
		this.editorService.openEditor(input);
	}

	private async startAssignment(assignment: IAssignment): Promise<void> {
		// Start assignment - download files, etc.
		await this.assignmentsService.startAssignment(assignment.id);
		// Refresh view
		const input = this.input as CourseDetailInput;
		this.setInput(input, {}, {}, CancellationToken.None);
	}

	private openAssignmentFiles(assignment: IAssignment): void {
		// Open assignment folder in explorer
		this.assignmentsService.openAssignmentFolder(assignment.id);
	}

	private async submitAssignment(assignment: IAssignment): Promise<void> {
		// Submit assignment
		await this.assignmentsService.submitAssignment(assignment.id);
		// Refresh view
		const input = this.input as CourseDetailInput;
		this.setInput(input, {}, {}, CancellationToken.None);
	}

	private viewSubmission(assignment: IAssignment): void {
		// Open submission details
		const input = new AssignmentDetailInput(assignment);
		this.editorService.openEditor(input);
	}

	private openCourseFiles(course: ICourse): void {
		// Open course files folder
		this.assignmentsService.openCourseFolder(course.id);
	}

	override clearInput(): void {
		if (this.headerContainer) {
			clearNode(this.headerContainer);
		}
		if (this.assignmentsContainer) {
			clearNode(this.assignmentsContainer);
		}
		this.assignmentsGrid = undefined;
		super.clearInput();
	}

	override layout(dimension: Dimension): void {
		// Handle layout
	}
}
