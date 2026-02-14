/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from '../../../../base/common/event.js';
import { append, $, addDisposableListener } from '../../../../base/browser/dom.js';
import * as DOM from '../../../../base/browser/dom.js';
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
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { IStudentService, IChatMessage, IStudentAssignment } from '../common/studentChatService.js';
import { renderMarkdown } from '../../../../base/browser/markdownRenderer.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { hasStoredStudentAuth } from '../../studentAuthentication/common/studentAuth.js';
import { localize } from '../../../../nls.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';

export class StudentChatPanel extends ViewPane {
	private _chatContainer!: HTMLElement;
	private _messagesContainer!: HTMLElement;
	private _inputContainer!: HTMLElement;
	private _messageInput!: HTMLTextAreaElement;
	private _sendButton!: HTMLButtonElement;
	private _clearButton!: HTMLButtonElement;
	private _loadingElement: HTMLElement | undefined;
	private _assignmentHeader!: HTMLElement;
	private _assignmentSelect!: HTMLSelectElement;
	private _assignments: IStudentAssignment[] = [];
	private _authPollInterval: number | undefined;

	private readonly _onMessageSent = this._register(new Emitter<string>());
	readonly onMessageSent: Event<string> = this._onMessageSent.event;

	// cached Intl formatter for timestamps
	private static readonly _timeFormatter = (date: Date): string =>
		date.toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit'
		});


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
		this._register(this.studentService.onChatMessage(message => this._handleIncomingMessage(message)));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._chatContainer = append(container, $('.student-chat-panel'));
		void this._initialize();
	}

	private _createLayout(): void {
		// Assignment selector header
		this._assignmentHeader = append(this._chatContainer, $('.chat-header'));
		const label = append(this._assignmentHeader, $('.chat-assignment-label'));
		label.textContent = localize('studentChatAssignmentLabel', "Assignment:");
		this._assignmentSelect = append(this._assignmentHeader, $('select.chat-assignment-select')) as HTMLSelectElement;
		this._assignmentSelect.appendChild(new Option(localize('studentChatAssignmentNone', "None"), ''));
		this._assignmentSelect.addEventListener('change', () => {
			const value = this._assignmentSelect.value;
			this.studentService.setCurrentAssignment(value || undefined);
		});

		// Messages container with scroll
		this._messagesContainer = append(this._chatContainer, $('.chat-messages'));

		// Input container
		this._inputContainer = append(this._chatContainer, $('.chat-input-container'));

		// Message Input
		this._messageInput = append(this._inputContainer, $('textarea.chat-input')) as HTMLTextAreaElement;
		this._messageInput.placeholder = localize('studentChatPlaceholder', "Ask me anything about your learning...");
		this._messageInput.setAttribute('aria-label', 'Chat message input');

		// Send Button
		this._sendButton = append(this._inputContainer, $('button.chat-send-button', { 'aria-label': 'Send message' })) as HTMLButtonElement;
		this._sendButton.textContent = localize('studentChatSend', "Send");

		// Clear Button
		this._clearButton = append(this._inputContainer, $('button.chat-clear-button', { 'aria-label': 'Clear chat history' })) as HTMLButtonElement;
		this._clearButton.textContent = localize('studentChatClear', "Clear");

		this._setupEventListeners();
	}

	private async _initialize(): Promise<void> {
		const isAuthed = await hasStoredStudentAuth(this.secretStorageService);
		if (!isAuthed) {
			this._renderSignInPrompt();
			this._startAuthWatcher();
			return;
		}

		this._createLayout();
		await this._loadAssignmentsForSelector();
		await this._loadChatHistory();
	}

	private async _loadAssignmentsForSelector(): Promise<void> {
		try {
			this._assignments = await this.studentService.getAssignments();
			// Clear existing options except the first ("None")
			while (this._assignmentSelect.options.length > 1) {
				this._assignmentSelect.remove(1);
			}
			for (const assignment of this._assignments) {
				const option = new Option(assignment.title, assignment.assignment_id);
				this._assignmentSelect.appendChild(option);
			}
			const current = this.studentService.getCurrentAssignment();
			if (current) {
				this._assignmentSelect.value = current;
			}
		} catch (error) {
			console.error('Failed to load assignments for chat selector:', error);
		}
	}

	private _setupEventListeners(): void {
		// Send button click
		this._register(addDisposableListener(this._sendButton, 'click', () => {
			this._sendMessage();
		}));

		// Enter key in input
		this._register(addDisposableListener(this._messageInput, 'keydown', (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);
			if (event.keyCode === KeyCode.Enter && !event.shiftKey) {
				e.preventDefault();
				this._sendMessage();
			}
		}));

		// Clear button click
		this._register(addDisposableListener(this._clearButton, 'click', async () => {
			this._clearChat();
		}));

		// Auto-resize input
		this._register(addDisposableListener(this._messageInput, 'input', () => {
			this._adjustInputHeight();
		}));
	}

	private async _sendMessage(): Promise<void> {
		const message = this._messageInput.value.trim();
		if (!message) {
			return;
		}

		// clear input and disable send button
		this._messageInput.value = '';
		this._sendButton.disabled = true;
		this._sendButton.textContent = 'Sending...';
		this._showLoadingIndicator();

		try {
			await this.studentService.sendChatMessage(message);
			this._onMessageSent.fire(message);
		} catch (error) {
			console.error('Error sending message:', error);
		} finally {
			this._hideLoadingIndicator();
			// re-enable send button
			this._sendButton.disabled = false;
			this._sendButton.textContent = 'Send';
			this._messageInput.focus();
		}
	}

	private _handleIncomingMessage(message: IChatMessage): void {
		if (!message.isUser) {
			this._hideLoadingIndicator();
		}
		this._addMessage(message);
	}

	private _addMessage(message: IChatMessage): void {
		const messageElement = append(this._messagesContainer, $('.chat-message', {
			'data-message-id': message.id,
			'data-is-user': message.isUser.toString()
		}));

		// message header (timestamp and sender)
		const headerElement = append(messageElement, $('.message-header'));
		const senderElement = append(headerElement, $('.message-sender'));
		senderElement.textContent = message.isUser ? 'You' : 'AI Assistant';

		const timestampElement = append(headerElement, $('.message-timestamp'));
		timestampElement.textContent = this._formatTimestamp(message.timestamp);

		// message content
		const contentElement = append(messageElement, $('.message-content'));


		// Render markdown content safely
		const md = new MarkdownString(message.content);
		md.isTrusted = false;
		md.supportThemeIcons = true;
		md.supportHtml = false;
		const renderedMarkdown = renderMarkdown(md, { codeBlockRenderer: undefined });
		append(contentElement, renderedMarkdown.element);

		// add user/AI specific classes
		if (message.isUser) {
			messageElement.classList.add('user-message');
		} else {
			messageElement.classList.add('ai-message');
		}

		// scroll to bottom
		this._scrollToBottom();
	}

	private async _loadChatHistory(): Promise<void> {
		try {
			const history = await this.studentService.getChatHistory();
			history.forEach(message => this._addMessage(message));
		} catch (error) {
			console.error('Failed to load chat history:', error);
		}
	}

	private _renderSignInPrompt(): void {
		// Clear container and show sign-in CTA
		while (this._chatContainer.firstChild) {
			this._chatContainer.removeChild(this._chatContainer.firstChild);
		}

		const wrapper = append(this._chatContainer, $('.student-auth-required'));
		const message = append(wrapper, $('.student-auth-message'));
		message.textContent = localize('studentAuthRequiredChat', "Sign in to your school account to chat with the AI assistant.");
		const button = append(wrapper, $('button.student-auth-button')) as HTMLButtonElement;
		button.textContent = localize('studentAuthSignInButton', "Sign In");
		this._register(addDisposableListener(button, 'click', async () => {
			await this.commandService.executeCommand('student.signIn');
		}));

		this._startAuthWatcher();
	}

	private _startAuthWatcher(): void {
		if (this._authPollInterval !== undefined) {
			return;
		}

		const targetWindow = this._chatContainer.ownerDocument.defaultView ?? DOM.getActiveWindow();
		this._authPollInterval = targetWindow.setInterval(async () => {
			const authed = await hasStoredStudentAuth(this.secretStorageService);
			if (!authed) {
				return;
			}

			if (this._authPollInterval !== undefined) {
				targetWindow.clearInterval(this._authPollInterval);
				this._authPollInterval = undefined;
			}

			while (this._chatContainer.firstChild) {
				this._chatContainer.removeChild(this._chatContainer.firstChild);
			}
			this._createLayout();
			await this._loadAssignmentsForSelector();
			await this._loadChatHistory();
		}, 1000);

		this._register(toDisposable(() => {
			if (this._authPollInterval !== undefined) {
				const disposeWindow = this._chatContainer.ownerDocument.defaultView ?? DOM.getActiveWindow();
				disposeWindow.clearInterval(this._authPollInterval);
				this._authPollInterval = undefined;
			}
		}));
	}

	private async _clearChat(): Promise<void> {
		try {
			await this.studentService.clearChatHistory();

			// clear all messages safely
			while (this._messagesContainer.firstChild) {
				this._messagesContainer.removeChild(this._messagesContainer.firstChild);
			}
		} catch (error) {
			console.error('Failed to clear chat history:', error);
		}
	}

	private _scrollToBottom(): void {
		this._messagesContainer.scrollTop = this._messagesContainer.scrollHeight;
	}

	private _showLoadingIndicator(): void {
		if (this._loadingElement) {
			return;
		}

		this._loadingElement = append(this._messagesContainer, $('.chat-loading'));
		const headerElement = append(this._loadingElement, $('.message-header'));
		const senderElement = append(headerElement, $('.message-sender'));
		senderElement.textContent = 'AI Assistant';

		const timestampElement = append(headerElement, $('.message-timestamp'));
		timestampElement.textContent = '...';

		const contentElement = append(this._loadingElement, $('.message-content'));
		contentElement.textContent = 'AI is thinking...';

		this._scrollToBottom();
	}

	private _hideLoadingIndicator(): void {
		if (!this._loadingElement || !this._loadingElement.parentElement) {
			this._loadingElement = undefined;
			return;
		}

		this._loadingElement.parentElement.removeChild(this._loadingElement);
		this._loadingElement = undefined;
	}

	private _adjustInputHeight(): void {
		this._messageInput.style.height = 'auto';
		this._messageInput.style.height = `${Math.min(this._messageInput.scrollHeight, 120)}px`;
	}

	private _formatTimestamp(timestamp: Date): string {
		return StudentChatPanel._timeFormatter(timestamp);
	}


	override focus(): void {
		super.focus();
		if (this._messageInput) {
			this._messageInput.focus();
		}
	}
}

