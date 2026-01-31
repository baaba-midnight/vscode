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
		@IStudentService private readonly studentService: IStudentService,
		@IOpenerService openerService: IOpenerService,
		@IHoverService hoverService: IHoverService,
		@INotificationService private readonly notificationService: INotificationService,
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
			this._renderTasksList();
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._containerElement = append(container, $('.student-task-panel'));

		// Top: current assignment details
		this._currentTaskContainer = append(this._containerElement, $('.current-task-container'));

		// Bottom: list of assignments (for context and selection)
		this._tasksListContainer = append(this._containerElement, $('.tasks-list-container'));

		// Reflection form
		this._reflectionContainer = append(this._containerElement, $('.reflection-container'));

		this._loadTasks();
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

	private _updateCurrentTask(): void {
		if (!Array.isArray(this._assignments) || this._assignments.length === 0) {
			this._currentAssignment = undefined;
			this._renderCurrentTask();
			this._onAssignmentSelected.fire(undefined);
			this._renderReflectionForm();
			return;
		}

		// Prefer the first incomplete assignment as the "current" one, fallback to first.
		const incomplete = this._assignments.find(assignment => !assignment.completed);
		this._currentAssignment = incomplete ?? this._assignments[0];
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

		const meta = append(header, $('.current-task-meta'));
		const difficulty = append(meta, $('.current-task-badge difficulty'));
		difficulty.textContent = this._currentAssignment.difficulty;

		const topic = append(meta, $('.current-task-topic'));
		topic.textContent = this._currentAssignment.topic;

		if (this._currentAssignment.estimatedTime) {
			const time = append(meta, $('.current-task-time'));
			time.textContent = `${this._currentAssignment.estimatedTime} min`;
		}

		if (this._currentAssignment.dueDate) {
			const due = append(meta, $('.current-task-due'));
			const date = this._currentAssignment.dueDate instanceof Date ? this._currentAssignment.dueDate : new Date(this._currentAssignment.dueDate);
			due.textContent = `Due ${date.toLocaleString()}`;
		}

		const body = append(this._currentTaskContainer, $('.current-task-body'));

		// Allow rich instructions as markdown if provided by backend.
		const md = new MarkdownString(this._currentAssignment.description);
		md.isTrusted = false;
		md.supportThemeIcons = true;
		md.supportHtml = false;
		const rendered = renderMarkdown(md, { codeBlockRenderer: undefined });
		append(body, rendered.element);
	}

	private _renderTasksList(): void {
		clearNode(this._tasksListContainer);

		if (!this._assignments.length) {
			const empty = append(this._tasksListContainer, $('.tasks-empty'));
			empty.textContent = 'No assignments have been assigned yet.';
			return;
		}

		const list = append(this._tasksListContainer, $('.tasks-list'));
		for (const assignment of this._assignments) {
			const item = append(list, $('.task-item', {
				'tabindex': '0',
				'data-task-id': assignment.id
			}));

			if (this._currentAssignment && this._currentAssignment.id === assignment.id) {
				item.classList.add('task-item-active');
			}

			if (assignment.completed) {
				item.classList.add('task-item-completed');
			}

			const title = append(item, $('.task-item-title'));
			title.textContent = assignment.title;

			const meta = append(item, $('.task-item-meta'));
			const difficulty = append(meta, $('.task-item-difficulty'));
			difficulty.textContent = assignment.difficulty;

			item.onclick = () => {
				this._currentAssignment = assignment;
				this._renderCurrentTask();
				this._renderTasksList();
				this._onAssignmentSelected.fire(assignment);
				this._renderReflectionForm();
			};
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
			await this.studentService.submitReflection(this._currentAssignment.id, confidence, difficulty, text || undefined);
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
			await this.studentService.submitAssignment(this._currentAssignment.id);
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

