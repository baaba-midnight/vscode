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
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { URI } from '../../../../base/common/uri.js';
import { hasStoredStudentAuth } from '../../student/common/studentAuth.js';
import { localize } from '../../../../nls.js';
import { IStudentService } from '../../student/common/studentService.js';

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
	private submissionContainer: HTMLElement | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IStudentAssignmentsService private readonly assignmentsService: IStudentAssignmentsService,
		@IStudentService private readonly studentService: IStudentService,
		@IEditorService private readonly editorService: IEditorService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@ICommandService private readonly commandService: ICommandService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IOpenerService private readonly openerService: IOpenerService,
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

		const isAuthed = await hasStoredStudentAuth(this.secretStorageService);
		if (!isAuthed) {
			this.renderSignInPrompt();
			return;
		}

		let course: ICourse | undefined;
		let assignments: IAssignment[] = [];
		let focusedAssignment: IAssignment | undefined;
		let showSubmission = false;

		if (input instanceof CourseDetailInput && input.course) {
			course = input.course;
			assignments = await this.assignmentsService.getAssignmentsByCourse(course.id);
		} else if (input instanceof AssignmentDetailInput && input.assignment) {
			const assignmentFromInput = input.assignment;
			// Ensure we have the full assignment payload (including files) from getAssignment
			const fullAssignment = await this.assignmentsService.getAssignment(assignmentFromInput.id) || assignmentFromInput;
			course = await this.assignmentsService.getCourse(fullAssignment.courseId);
			if (course) {
				assignments = await this.assignmentsService.getAssignmentsByCourse(course.id);
			}
			focusedAssignment = fullAssignment;
			if (input.view === 'submission') {
				showSubmission = true;
			}
		}

		if (!course || token.isCancellationRequested) {
			return;
		}

		this.renderCourseHeader(course);
		clearNode(this.assignmentsContainer);
		if (focusedAssignment) {
			this.renderFocusedAssignmentHeader(course, focusedAssignment);
			if (showSubmission) {
				await this.renderSubmissionDetails(focusedAssignment);
			} else {
				this.renderAssignmentFiles(focusedAssignment);
			}
		} else {
			this.renderAssignments(assignments);
		}
	}

	private renderFocusedAssignmentHeader(course: ICourse, assignment: IAssignment): void {
		const container = append(this.assignmentsContainer, $('.assignment-focus'));

		const header = append(container, $('.assignment-focus-header'));

		const titleRow = append(header, $('.title-row'));
		const title = append(titleRow, $('h2.assignment-title'));
		title.textContent = assignment.title;

		const statusBadge = append(titleRow, $('.status-badge'));
		statusBadge.textContent = this.getStatusLabel(assignment.status);
		statusBadge.classList.add(`status-${assignment.status}`);

		const meta = append(header, $('.card-meta'));
		const dueDate = append(meta, $('.meta-item'));
		dueDate.textContent = `Due: ${this.formatDate(assignment.dueDate)}`;

		const points = append(meta, $('.meta-item'));
		points.textContent = `${assignment.points} points`;

		const type = append(meta, $('.meta-item'));
		type.textContent = `Type: ${assignment.type}`;

		if (assignment.description) {
			const description = append(container, $('.assignment-description'));
			description.textContent = assignment.description;
		}

		const actions = append(container, $('.assignment-focus-actions'));

		const openFolderBtn = append(actions, $('button.btn-secondary'));
		openFolderBtn.textContent = 'Open Assignment Folder';
		addDisposableListener(openFolderBtn, EventType.CLICK, e => {
			e.stopPropagation();
			this.openAssignmentFiles(assignment);
		});

		const backBtn = append(actions, $('button.btn-primary'));
		backBtn.textContent = 'Back to Assignments';
		addDisposableListener(backBtn, EventType.CLICK, e => {
			e.stopPropagation();
			const input = new CourseDetailInput(course);
			this.editorService.openEditor(input);
		});
	}

	private renderSignInPrompt(): void {
		clearNode(this.container);
		const wrapper = append(this.container, $('.student-auth-required'));
		const message = append(wrapper, $('.student-auth-message'));
		message.textContent = localize('studentAuthRequiredCourseDetail', "Sign in to your school account to view course details and assignments.");
		const button = append(wrapper, $('button.student-auth-button')) as HTMLButtonElement;
		button.textContent = localize('studentAuthSignInButton', "Sign In");
		addDisposableListener(button, EventType.CLICK, async () => {
			await this.commandService.executeCommand('student.signIn');
			const authed = await hasStoredStudentAuth(this.secretStorageService);
			if (authed) {
				// After sign-in, re-run setInput with existing input to load content.
				const currentInput = this.input;
				if (currentInput) {
					void this.setInput(currentInput, {}, {}, CancellationToken.None);
				}
			}
		});
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

		const title = append(info, $('h1.course-header-title'));
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
			const description = append(info, $('.course-header-description'));
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

	private async renderSubmissionDetails(assignment: IAssignment): Promise<void> {
		if (this.submissionContainer) {
			this.submissionContainer.remove();
			this.submissionContainer = undefined;
		}

		const container = append(this.assignmentsContainer, $('.submission-section'));
		this.submissionContainer = container;

		const header = append(container, $('.section-header'));
		const title = append(header, $('h2'));
		title.textContent = 'Submission';

		const submission = await this.assignmentsService.getSubmission(assignment.id);
		if (!submission) {
			const message = append(container, $('.empty-state'));
			message.textContent = 'No submission details are available for this assignment.';
			return;
		}

		const meta = append(container, $('.submission-meta'));
		const statusItem = append(meta, $('.meta-item'));
		statusItem.textContent = submission.submitted ? 'Submitted' : 'Not Submitted';

		if (submission.submittedAt) {
			const submittedAt = append(meta, $('.meta-item'));
			submittedAt.textContent = `Submitted at: ${submission.submittedAt.toLocaleString()}`;
		}

		const scoreItem = append(meta, $('.meta-item'));
		if (submission.score !== null && typeof submission.score === 'number') {
			scoreItem.textContent = `Score: ${submission.score}`;
		} else {
			scoreItem.textContent = 'Score: Not graded yet';
		}

		if (submission.feedback) {
			const feedback = append(container, $('.submission-feedback'));
			feedback.textContent = submission.feedback;
		}

		if (submission.files && submission.files.length) {
			const filesHeader = append(container, $('h3'));
			filesHeader.textContent = 'Submitted Files';
			const list = append(container, $('ul.submission-files'));
			for (const file of submission.files) {
				const item = append(list, $('li'));
				const nameSpan = append(item, $('span.filename'));
				nameSpan.textContent = file.filename;
				const typeSpan = append(item, $('span.mime-type'));
				typeSpan.textContent = ` (${file.mimeType})`;
				const previewBtn = append(item, $('button.btn-secondary'));
				previewBtn.textContent = 'Preview';
				addDisposableListener(previewBtn, EventType.CLICK, e => {
					e.stopPropagation();
					this.openerService.open(URI.parse(file.url));
				});
			}
		} else {
			const noFiles = append(container, $('.empty-state'));
			noFiles.textContent = 'No files were submitted with this assignment.';
		}
	}

	private renderAssignmentFiles(assignment: IAssignment): void {
		const container = append(this.assignmentsContainer, $('.submission-section assignment-files-section'));

		const header = append(container, $('.section-header'));
		const title = append(header, $('h2'));
		title.textContent = 'Assignment Files';

		if (!assignment.files || assignment.files.length === 0) {
			const empty = append(container, $('.empty-state'));
			empty.textContent = 'No files are attached to this assignment.';
			return;
		}

		const list = append(container, $('ul.submission-files'));
		for (const file of assignment.files) {
			const item = append(list, $('li'));
			const nameSpan = append(item, $('span.filename'));
			nameSpan.textContent = file.name;
			const typeSpan = append(item, $('span.mime-type'));
			typeSpan.textContent = ` (${file.type}${file.required ? ', required' : ''})`;
			const previewBtn = append(item, $('button.btn-secondary'));
			previewBtn.textContent = 'Preview';
			addDisposableListener(previewBtn, EventType.CLICK, e => {
				e.stopPropagation();
				const url = file.downloadUrl;
				if (!url) {
					console.warn('No download URL available for assignment file', file.name);
					return;
				}
				this.openerService.open(URI.parse(url));
			});
		}
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
			addDisposableListener(startBtn, EventType.CLICK, e => {
				e.stopPropagation();
				this.startAssignment(assignment);
			});
		} else if (assignment.status === AssignmentStatus.InProgress || assignment.status === AssignmentStatus.Overdue) {
			const continueBtn = append(actionsContainer, $('button.btn-secondary'));
			continueBtn.textContent = 'Continue Working';
			addDisposableListener(continueBtn, EventType.CLICK, e => {
				e.stopPropagation();
				this.openAssignmentFiles(assignment);
			});

			const submitBtn = append(actionsContainer, $('button.btn-primary'));
			submitBtn.textContent = 'Submit';
			addDisposableListener(submitBtn, EventType.CLICK, e => {
				e.stopPropagation();
				this.submitAssignment(assignment);
			});
		} else if (assignment.status === AssignmentStatus.Submitted) {
			const viewBtn = append(actionsContainer, $('button.btn-secondary'));
			viewBtn.textContent = 'View Submission';
			addDisposableListener(viewBtn, EventType.CLICK, e => {
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
		const input = new AssignmentDetailInput(assignment, 'details');
		this.editorService.openEditor(input);
	}

	private async startAssignment(assignment: IAssignment): Promise<void> {
		// Start assignment - download files
		await this.assignmentsService.startAssignment(assignment.id);
		// Let the shared student service know which assignment is active for AI chat
		this.studentService.setCurrentAssignment(assignment.id);
		// Immediately open the assignment folder so the student sees the files
		await this.assignmentsService.openAssignmentFolder(assignment.id);
		// Refresh view (status / buttons may have changed)
		const input = this.input as CourseDetailInput;
		this.setInput(input, {}, {}, CancellationToken.None);
	}

	private openAssignmentFiles(assignment: IAssignment): void {
		// When continuing an assignment, ensure AI chat is scoped to it
		this.studentService.setCurrentAssignment(assignment.id);
		// Open assignment folder in explorer
		this.assignmentsService.openAssignmentFolder(assignment.id);
	}

	private async submitAssignment(assignment: IAssignment): Promise<void> {
		const selection = await this.fileDialogService.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: true,
			title: 'Select Assignment Files to Submit',
			openLabel: 'Submit'
		});

		if (!selection || !selection.length) {
			return;
		}

		const fileUris = selection.map(uri => uri.toString());
		await this.assignmentsService.submitAssignment(assignment.id, fileUris);
		const input = this.input as CourseDetailInput;
		this.setInput(input, {}, {}, CancellationToken.None);
	}

	private viewSubmission(assignment: IAssignment): void {
		// Open submission details
		const input = new AssignmentDetailInput(assignment, 'submission');
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
		this.submissionContainer = undefined;
		this.assignmentsGrid = undefined;
		super.clearInput();
	}

	override layout(dimension: Dimension): void {
		// Handle layout
	}
}
