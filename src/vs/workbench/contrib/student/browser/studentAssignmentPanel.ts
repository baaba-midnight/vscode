/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from '../../../../base/common/event.js';
import { append, $, clearNode, addDisposableListener } from '../../../../base/browser/dom.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ViewPane, IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IStudentService, IStudentAssignment } from '../common/studentService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { renderMarkdown } from '../../../../base/browser/markdownRenderer.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { joinPath } from '../../../../base/common/resources.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { hasStoredStudentAuth } from '../common/studentAuth.js';
import { localize } from '../../../../nls.js';

export class StudentAssignmentPanel extends ViewPane {
	private _containerElement!: HTMLElement;
	private _currentTaskContainer!: HTMLElement;
	private _tasksListContainer!: HTMLElement;
	private _reflectionContainer!: HTMLElement;
	private _currentAssignment: IStudentAssignment | undefined;
	private _assignments: IStudentAssignment[] = [];

	private readonly _onAssignmentSelected = this._register(new Emitter<IStudentAssignment | undefined>());
	readonly onAssignmentSelected: Event<IStudentAssignment | undefined> = this._onAssignmentSelected.event;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IFileService private readonly fileService: IFileService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IStudentService private readonly studentService: IStudentService,
		@IOpenerService openerService: IOpenerService,
		@IHoverService hoverService: IHoverService,
		@INotificationService private readonly notificationService: INotificationService,
		@ICommandService private readonly commandService: ICommandService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
	) {
		super(
			options,
			keybindingService,
			contextMenuService,
			configurationService,
			contextKeyService,
			viewDescriptorService,
			instantiationService,
			openerService,
			themeService,
			hoverService
		);

		this._register(this.studentService.onAssignmentsUpdate(assignments => {
			this._assignments = assignments;
			this._updateCurrentTask();
			this._renderCurrentTask();
			this._renderTasksList();
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._containerElement = append(container, $('.student-task-panel'));
		this._createLayout();
		void this._initialize();
	}

	private _createLayout(): void {
		clearNode(this._containerElement);
		// Top: current assignment details
		this._currentTaskContainer = append(this._containerElement, $('.current-task-container'));
		// Bottom: list of assignments (for context and selection)
		this._tasksListContainer = append(this._containerElement, $('.tasks-list-container'));
		// Reflection form
		this._reflectionContainer = append(this._containerElement, $('.reflection-container'));
	}

	private async _initialize(): Promise<void> {
		const isAuthed = await hasStoredStudentAuth(this.secretStorageService);
		if (!isAuthed) {
			this._renderSignInPrompt();
			return;
		}
		await this._loadTasks();
	}

	private async _loadTasks(): Promise<void> {
		try {
			this._assignments = await this.studentService.getAssignments();
			this._updateCurrentTask();
			this._renderCurrentTask();
			this._renderTasksList();
		} catch (error) {
			console.error('Failed to load student tasks:', error);
		}
	}

	private _renderSignInPrompt(): void {
		clearNode(this._containerElement);
		const wrapper = append(this._containerElement, $('.student-auth-required'));
		const message = append(wrapper, $('.student-auth-message'));
		message.textContent = localize('studentAuthRequiredAssignmentsPanel', "Sign in to your school account to view assignments.");
		const button = append(wrapper, $('button.student-auth-button')) as HTMLButtonElement;
		button.textContent = localize('studentAuthSignInButton', "Sign In");
		this._register(addDisposableListener(button, 'click', async () => {
			await this.commandService.executeCommand('student.signIn');
			const authed = await hasStoredStudentAuth(this.secretStorageService);
			if (authed) {
				this._createLayout();
				await this._loadTasks();
			}
		}));
	}

	private _updateCurrentTask(): void {
		if (!Array.isArray(this._assignments) || this._assignments.length === 0) {
			this._currentAssignment = undefined;
			this.studentService.setCurrentAssignment(undefined);
			this._renderCurrentTask();
			this._onAssignmentSelected.fire(undefined);
			this._renderReflectionForm();
			return;
		}

		// Preserve the currently selected assignment if it still exists;
		// otherwise fall back to the first assignment.
		if (this._currentAssignment) {
			const existing = this._assignments.find(a => a.assignment_id === this._currentAssignment!.assignment_id);
			this._currentAssignment = existing ?? this._assignments[0];
		} else {
			this._currentAssignment = this._assignments[0];
		}
		this.studentService.setCurrentAssignment(this._currentAssignment.assignment_id);
		void this._loadAssignmentDetails(this._currentAssignment.assignment_id);
		this._renderCurrentTask();
		this._onAssignmentSelected.fire(this._currentAssignment);
		this._renderReflectionForm();
	}

	private _renderCurrentTask(): void {
		clearNode(this._currentTaskContainer);

		if (!this._currentAssignment) {
			const emptyElement = append(this._currentTaskContainer, $('.current-task-empty'));
			emptyElement.textContent = 'No active assignment is available. Please check back later.';
			return;
		}

		const header = append(this._currentTaskContainer, $('.current-task-header'));
		const title = append(header, $('.current-task-title'));
		title.textContent = this._currentAssignment.title;

		const actions = append(header, $('.current-task-actions'));
		const startButton = append(actions, $('button.current-task-start-button')) as HTMLButtonElement;
		startButton.textContent = 'Start Assignment';
		this._register(addDisposableListener(startButton, 'click', () => {
			void this._startAssignment();
		}));

		const meta = append(header, $('.current-task-meta'));

		if (this._currentAssignment.due_date) {
			const due = append(meta, $('.current-task-due'));
			const date = new Date(this._currentAssignment.due_date);
			due.textContent = `Due ${date.toLocaleString()}`;
		}

		const body = append(this._currentTaskContainer, $('.current-task-body'));

		// Allow rich instructions as markdown if provided by backend.
		const md = new MarkdownString(this._currentAssignment.description);
		md.isTrusted = false;
		md.supportThemeIcons = true;
		md.supportHtml = false;
		const rendered = renderMarkdown(md, { codeBlockRenderer: undefined });
		this._register(rendered);
		append(body, rendered.element);

		if (this._currentAssignment.files && this._currentAssignment.files.length) {
			const filesHeader = append(body, $('.current-task-files-header'));
			filesHeader.textContent = 'Files';

			const filesList = append(body, $('.current-task-files-list'));
			for (const file of this._currentAssignment.files) {
				const fileItem = append(filesList, $('.current-task-file-item'));
				const displayName = file.filename ?? file.file_name ?? 'File';
				const url = file.url ?? file.file_path;
				fileItem.textContent = displayName;
				fileItem.title = url ?? '';
				if (url) {
					this._register(addDisposableListener(fileItem, 'click', () => {
						this.openerService.open(URI.parse(url));
					}));
				}
			}
		}
	}

	private _sanitizeFolderName(name: string): string {
		const sanitized = name.replace(/[\\/:*?"<>|]/g, '_').trim();
		return sanitized || 'assignment';
	}

	private async _startAssignment(): Promise<void> {
		if (!this._currentAssignment || !this._currentAssignment.files || !this._currentAssignment.files.length) {
			this.notificationService.warn('This assignment has no attached files to download.');
			return;
		}

		const folderResult = await this.fileDialogService.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			title: 'Select Folder for Assignment Files',
			openLabel: 'Select Folder'
		});
		if (!folderResult || !folderResult.length) {
			return;
		}

		const baseFolder = folderResult[0];
		const folderName = this._sanitizeFolderName(this._currentAssignment.title || 'assignment');
		const assignmentFolder = joinPath(baseFolder, folderName);
		await this.fileService.createFolder(assignmentFolder);

		for (const file of this._currentAssignment.files) {
			const url = file.url ?? file.file_path;
			if (!url) {
				continue;
			}

			const fileName = file.filename ?? file.file_name ?? 'file';
			try {
				const response = await fetch(url);
				if (!response.ok) {
					continue;
				}
				const arrayBuffer = await response.arrayBuffer();
				const buffer = VSBuffer.wrap(new Uint8Array(arrayBuffer));
				const target = joinPath(assignmentFolder, fileName);
				await this.fileService.writeFile(target, buffer);
			} catch (error) {
				console.error('Failed to download assignment file', error);
			}
		}

		this.notificationService.info('Assignment files downloaded to the selected folder.');
	}

	private _renderTasksList(): void {
		clearNode(this._tasksListContainer);

		if (!this._assignments.length) {
			const empty = append(this._tasksListContainer, $('.tasks-empty'));
			empty.textContent = 'No assignments have been assigned yet.';
			return;
		}

		const header = append(this._tasksListContainer, $('.tasks-header'));
		header.textContent = this._assignments.length > 1
			? `Assignments (${this._assignments.length}) - click to switch`
			: 'Assignments';

		const list = append(this._tasksListContainer, $('.tasks-list'));
		for (const assignment of this._assignments) {
			const item = append(list, $('.task-item', {
				'tabindex': '0',
				'data-task-id': assignment.assignment_id
			}));

			if (this._currentAssignment && this._currentAssignment.assignment_id === assignment.assignment_id) {
				item.classList.add('task-item-active');
			}



			item.onclick = () => {
				this._currentAssignment = assignment;
				this._renderCurrentTask();
				this._renderTasksList();
				this._onAssignmentSelected.fire(assignment);
				this.studentService.setCurrentAssignment(assignment.assignment_id);
				this._renderReflectionForm();
				void this._loadAssignmentDetails(assignment.assignment_id);
			};
		}
	}

	private async _loadAssignmentDetails(assignmentId: string): Promise<void> {
		try {
			const detailed = await this.studentService.getAssignmentById(assignmentId);
			if (!detailed) {
				return;
			}

			const index = this._assignments.findIndex(a => a.assignment_id === detailed.assignment_id);
			if (index !== -1) {
				this._assignments[index] = detailed;
			}

			if (this._currentAssignment && this._currentAssignment.assignment_id === detailed.assignment_id) {
				this._currentAssignment = detailed;
				this._renderCurrentTask();
				this._renderTasksList();
				this._renderReflectionForm();
			}
		} catch (error) {
			console.error('Failed to load assignment details:', error);
		}
	}

	private _renderReflectionForm(): void {
		clearNode(this._reflectionContainer);

		if (!this._currentAssignment) {
			const empty = append(this._reflectionContainer, $('.reflection-empty'));
			empty.textContent = 'Select an assignment to submit a reflection.';
			return;
		}

		const header = append(this._reflectionContainer, $('.reflection-header'));
		header.textContent = 'Reflection';

		const controlsRow = append(this._reflectionContainer, $('.reflection-controls'));
		const confidenceLabel = append(controlsRow, $('.reflection-label'));
		confidenceLabel.textContent = 'Confidence:';
		const confidenceSelect = append(controlsRow, $('select.reflection-select')) as HTMLSelectElement;
		for (let i = 1; i <= 5; i++) {
			const option = document.createElement('option');
			option.value = String(i);
			option.text = `${i}`;
			confidenceSelect.appendChild(option);
		}

		const difficultyLabel = append(controlsRow, $('.reflection-label'));
		difficultyLabel.textContent = 'Difficulty:';
		const difficultySelect = append(controlsRow, $('select.reflection-select')) as HTMLSelectElement;
		['easy', 'medium', 'hard'].forEach(value => {
			const option = document.createElement('option');
			option.value = value;
			option.text = value.charAt(0).toUpperCase() + value.slice(1);
			difficultySelect.appendChild(option);
		});

		const textArea = append(this._reflectionContainer, $('textarea.reflection-textarea')) as HTMLTextAreaElement;
		textArea.placeholder = 'Optionally describe what felt easy or hard about this assignment...';

		const submitButton = append(this._reflectionContainer, $('button.reflection-submit-button')) as HTMLButtonElement;
		submitButton.textContent = 'Submit Reflection';

		this._register(addDisposableListener(submitButton, 'click', async () => {
			await this._submitReflection(confidenceSelect, difficultySelect, textArea, submitButton);
		}));

		const submitAssignmentButton = append(this._reflectionContainer, $('button.reflection-submit-button')) as HTMLButtonElement;
		submitAssignmentButton.textContent = 'Submit Assignment';
		this._register(addDisposableListener(submitAssignmentButton, 'click', async () => {
			await this._submitAssignment(submitAssignmentButton);
		}));
	}

	private async _submitReflection(confidenceSelect: HTMLSelectElement, difficultySelect: HTMLSelectElement, textArea: HTMLTextAreaElement, submitButton: HTMLButtonElement): Promise<void> {
		if (!this._currentAssignment) {
			return;
		}

		const confidence = Number(confidenceSelect.value) || 0;
		const difficulty = difficultySelect.value;
		const text = textArea.value.trim();

		submitButton.disabled = true;
		const previousLabel = submitButton.textContent;
		submitButton.textContent = 'Submitting...';

		try {
			await this.studentService.submitReflection(this._currentAssignment.assignment_id, confidence, difficulty, text || undefined);
			this.notificationService.info('Reflection submitted successfully.');
			textArea.value = '';
		} catch (error) {
			console.error('Failed to submit reflection:', error);
			this.notificationService.error('Failed to submit reflection. Please try again.');
		} finally {
			submitButton.disabled = false;
			submitButton.textContent = previousLabel;
		}
	}

	private async _submitAssignment(submitButton: HTMLButtonElement): Promise<void> {
		if (!this._currentAssignment) {
			return;
		}

		submitButton.disabled = true;
		const previousLabel = submitButton.textContent;
		submitButton.textContent = 'Submitting...';

		try {
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
			await this.studentService.submitAssignment(this._currentAssignment.assignment_id, fileUris);
			this.notificationService.info('Assignment submitted successfully.');
		} catch (error) {
			console.error('Failed to submit assignment:', error);
			this.notificationService.error('Failed to submit assignment. Please try again.');
		} finally {
			submitButton.disabled = false;
			submitButton.textContent = previousLabel;
		}
	}
}

