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
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IStudentService } from '../../studentChat/common/studentChatService.js';
import { IStudentAuthService, AuthState } from '../../studentAuthentication/common/studentAuth.js';

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
		@IStudentAuthService private readonly authService: IStudentAuthService,
		@ICommandService _commandService: ICommandService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IOpenerService private readonly openerService: IOpenerService,
	) {
		super(CourseDetailEditor.ID, group, telemetryService, themeService, storageService);

		// Listen for auth state changes
		this._register(this.authService.onDidAuthStateChange(state => {
			console.log('[CourseDetailEditor] Auth state changed:', state);
			if (state === AuthState.Authenticated) {
				// Reload editor when user logs in
				const currentInput = this.input;
				if (currentInput) {
					void this.setInput(currentInput, {}, {}, CancellationToken.None);
				}
			} else if (state === AuthState.Unauthenticated) {
				// Show login prompt when user logs out
				this.renderSignInPrompt();
			}
		}));
	}

	protected createEditor(parent: HTMLElement): void {
		this.container = append(parent, $('.course-detail-editor'));

		// Course header section
		this.headerContainer = append(this.container, $('.course-header'));

		// Assignment cards section
		this.assignmentsContainer = append(this.container, $('.assignments-section'));
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		console.log('[CourseDetailEditor] setInput called');

		await super.setInput(input, options, context, token);

		// Wait for auth to be ready
		await this.authService.whenReady();

		// Check if authenticated
		if (this.authService.state !== AuthState.Authenticated) {
			console.log('[CourseDetailEditor] Not authenticated, showing login prompt');
			this.renderSignInPrompt();
			return;
		}

		let course: ICourse | undefined;
		let assignments: IAssignment[] = [];
		let focusedAssignment: IAssignment | undefined;
		let showSubmission = false;

		try {
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
		} catch (error) {
			console.error('[CourseDetailEditor] Failed to load data:', error);

			// Handle 401 errors
			if (this.isHttpError(error) && error.status === 401) {
				console.log('[CourseDetailEditor] Got 401, attempting token refresh...');
				const refreshed = await this.authService.refreshAccessToken();
				if (refreshed) {
					// Retry loading
					await this.setInput(input, options, context, token);
					return;
				} else {
					// Refresh failed, show login
					this.renderSignInPrompt();
					return;
				}
			} else {
				// Other error, show error message
				this.renderError(error);
				return;
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

	private renderSignInPrompt(): void {
		clearNode(this.container);
		const wrapper = append(this.container, $('.student-auth-required.empty-state-signed-out'));
		append(wrapper, $('span.empty-state-icon' + ThemeIcon.asCSSSelector(Codicon.book)));
		const hint = append(wrapper, $('.student-auth-hint'));
		hint.textContent = localize('studentAuthHint', "Not signed in yet");
		const message = append(wrapper, $('.student-auth-message'));
		message.textContent = localize('studentAuthRequiredCourseDetail', "Sign in to your school account to view course details and assignments.");
	}

	private renderError(error: unknown): void {
		clearNode(this.container);
		const wrapper = append(this.container, $('.error-state'));
		const message = append(wrapper, $('.error-message'));
		message.textContent = localize('courseDetailError', "Failed to load course details. Please try again.");

		const errorDetails = append(wrapper, $('.error-details'));
		const errorMessage = error instanceof Error ? error.message : String(error ?? 'Unknown error');
		errorDetails.textContent = errorMessage;

		const button = append(wrapper, $('button.retry-button')) as HTMLButtonElement;
		button.textContent = localize('courseDetailRetry', "Retry");
		addDisposableListener(button, EventType.CLICK, async () => {
			const currentInput = this.input;
			if (currentInput) {
				await this.setInput(currentInput, {}, {}, CancellationToken.None);
			}
		});
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

		if (course.code) {
			const code = append(meta, $('.meta-item'));
			code.textContent = `Code: ${course.code}`;
		}

		if (course.description) {
			const desc = append(info, $('.course-description'));
			desc.textContent = course.description;
		}
	}

	private renderAssignments(assignments: IAssignment[]): void {
		if (!assignments.length) {
			const empty = append(this.assignmentsContainer, $('.empty-state'));
			empty.textContent = localize('noAssignments', "No assignments available for this course.");
			return;
		}

		const header = append(this.assignmentsContainer, $('.assignments-header'));
		const title = append(header, $('h2'));
		title.textContent = localize('assignments', "Assignments ({0})", assignments.length);

		this.assignmentsGrid = append(this.assignmentsContainer, $('.assignments-grid'));

		for (const assignment of assignments) {
			const card = this.createAssignmentCard(assignment);
			this.assignmentsGrid.appendChild(card);
		}
	}

	private async renderSubmissionDetails(assignment: IAssignment): Promise<void> {
		const submission = await this.assignmentsService.getSubmission(assignment.id);

		this.submissionContainer = append(this.assignmentsContainer, $('.submission-details'));

		const header = append(this.submissionContainer, $('h3'));
		header.textContent = 'Submission Details';

		if (!submission || !submission.submitted) {
			const notSubmitted = append(this.submissionContainer, $('.empty-state'));
			notSubmitted.textContent = 'This assignment has not been submitted yet.';
			return;
		}

		const info = append(this.submissionContainer, $('.submission-info'));

		const submittedAt = append(info, $('.info-item'));
		submittedAt.textContent = `Submitted: ${submission.submittedAt ? submission.submittedAt.toLocaleString() : 'N/A'}`;

		const score = append(info, $('.info-item'));
		score.textContent = `Score: ${submission.score !== null ? `${submission.score}/${assignment.points}` : 'Not graded yet'}`;

		if (submission.gradedAt) {
			const gradedAt = append(info, $('.info-item'));
			gradedAt.textContent = `Graded: ${submission.gradedAt.toLocaleString()}`;
		}

		if (submission.feedback) {
			const feedbackSection = append(this.submissionContainer, $('.feedback-section'));
			const feedbackTitle = append(feedbackSection, $('h4'));
			feedbackTitle.textContent = 'Feedback';
			const feedbackText = append(feedbackSection, $('.feedback-text'));
			feedbackText.textContent = submission.feedback;
		}

		if (submission.files && submission.files.length > 0) {
			const filesSection = append(this.submissionContainer, $('.submission-files-section'));
			const filesTitle = append(filesSection, $('h4'));
			filesTitle.textContent = 'Submitted Files';
			const filesList = append(filesSection, $('ul.submission-files'));
			for (const file of submission.files) {
				const item = append(filesList, $('li'));
				const link = append(item, $('a')) as HTMLAnchorElement;
				link.textContent = file.filename;
				link.href = file.url;
				link.target = '_blank';
				addDisposableListener(link, EventType.CLICK, e => {
					e.preventDefault();
					this.openerService.open(URI.parse(file.url));
				});
			}
		}
	}

	private renderAssignmentFiles(assignment: IAssignment): void {
		const container = append(this.assignmentsContainer, $('.assignment-files-section'));
		const title = append(container, $('h3'));
		title.textContent = 'Assignment Files';

		if (!assignment.files || assignment.files.length === 0) {
			const empty = append(container, $('.empty-state'));
			empty.textContent = 'No files are attached to this assignment.';
			return;
		}

		const list = append(container, $('ul.submission-files'));
		for (const file of assignment.files) {
			console.log('[CourseDetailEditor] Rendering assignment details:', assignment);
			console.log('Rendering file:', file.name, file.type, file.downloadUrl);

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
		// Start assignment - download files and mark as started
		await this.assignmentsService.startAssignment(assignment.id);
		// Let the shared student service know which assignment is active for AI chat
		this.studentService.setCurrentAssignment(assignment.id);
		// Open the assignment as a single-folder workspace
		await this.assignmentsService.openAssignmentWorkspace(assignment.id);
		// Refresh view (status / buttons may have changed)
		const input = this.input as CourseDetailInput;
		this.setInput(input, {}, {}, CancellationToken.None);
	}

	private openAssignmentFiles(assignment: IAssignment): void {
		// When continuing an assignment, ensure AI chat is scoped to it
		this.studentService.setCurrentAssignment(assignment.id);
		// Open the same single-folder workspace used when starting the assignment
		void this.assignmentsService.openAssignmentWorkspace(assignment.id);
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

	private isHttpError(error: unknown): error is { status: number } {
		return typeof (error as { status?: unknown }).status === 'number';
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
