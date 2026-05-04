/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from '../../../../base/common/event.js';
import { append, $, addDisposableListener } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
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
import { IStudentService, IChatMessage } from '../common/studentChatService.js';
import { renderMarkdown, IRenderedMarkdown } from '../../../../base/browser/markdownRenderer.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { hasStoredStudentAuth } from '../../studentAuthentication/common/studentAuth.js';
import { localize } from '../../../../nls.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';

export class StudentChatPanel extends ViewPane {
	private _chatContainer!: HTMLElement;
	private _messagesContainer!: HTMLElement;
	private _messageDisposables: IRenderedMarkdown[] = [];
	private _inputContainer!: HTMLElement;
	private _messageInput!: HTMLTextAreaElement;
	private _sendButton!: HTMLButtonElement;
	private _clearButton!: HTMLButtonElement;
	private _loadingElement: HTMLElement | undefined;
	private _assignmentHeader!: HTMLElement;
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
		this._register(this.studentService.onCurrentAssignmentChange(() => {
			this._updateAssignmentHeader();
			this._loadChatHistory();
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._chatContainer = append(container, $('.student-chat-panel'));
		void this._initialize();
	}

	private _createLayout(): void {
		// Assignment context header (read-only)
		this._assignmentHeader = append(this._chatContainer, $('.chat-assignment-header'));
		this._updateAssignmentHeader();

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

	private _updateAssignmentHeader(): void {
		if (!this._assignmentHeader) {
			return;
		}

		// Clear existing header content
		while (this._assignmentHeader.firstChild) {
			this._assignmentHeader.removeChild(this._assignmentHeader.firstChild);
		}

		const context = this.studentService.getCurrentAssignmentContext();

		if (!context) {
			// No assignment active - show nudge with navigation button
			this._assignmentHeader.classList.add('chat-assignment-header--empty');
			this._assignmentHeader.classList.remove('chat-assignment-header--active');

			const icon = append(this._assignmentHeader, $('span.chat-assignment-no-icon'));
			icon.textContent = 'CP';
			const text = append(this._assignmentHeader, $('span.chat-assignment-no-text'));
			text.textContent = localize('studentChatNoAssignment', "No assignment selected");
			const btn = append(this._assignmentHeader, $('button.chat-go-to-assignments-btn')) as HTMLButtonElement;
			btn.textContent = localize('studentChatGoToAssignments', "Go to Assignments");
			this._register(addDisposableListener(btn, 'click', () => {
				void this.commandService.executeCommand('workbench.view.studentAssignments.focus');
			}));

			// Disable input when no assignment is active
			this._setInputEnabled(false);
		} else {
			// Assignment is active - render rich read-only context card
			this._assignmentHeader.classList.add('chat-assignment-header--active');
			this._assignmentHeader.classList.remove('chat-assignment-header--empty');

			const left = append(this._assignmentHeader, $('.chat-assignment-info'));

			if (context.courseName) {
				const course = append(left, $('span.chat-assignment-course'));
				course.textContent = context.courseName;
			}

			const title = append(left, $('span.chat-assignment-title'));
			title.textContent = context.title;

			if (context.dueDate) {
				const due = append(left, $('span.chat-assignment-due'));
				const formatted = this._formatDueDate(context.dueDate);
				due.textContent = localize('studentChatDue', "Due {0}", formatted);
			}

			const right = append(this._assignmentHeader, $('.chat-assignment-meta'));
			if (context.status) {
				const badge = append(right, $('span.chat-assignment-status-badge'));
				badge.textContent = this._formatStatus(context.status);
				badge.classList.add(`chat-assignment-status--${context.status.toLowerCase().replace(/\s+/g, '-')}`);
			}

			this._setInputEnabled(true);
		}
	}

	private _setInputEnabled(enabled: boolean): void {
		if (!this._messageInput || !this._sendButton) {
			return;
		}
		this._messageInput.disabled = !enabled;
		this._sendButton.disabled = !enabled;
		if (!enabled) {
			this._messageInput.placeholder = localize('studentChatDisabledPlaceholder', "Select an assignment to start chatting...");
		} else {
			this._messageInput.placeholder = localize('studentChatPlaceholder', "Ask me anything about your learning...");
		}
	}

	private _formatStatus(status: string): string {
		switch (status.toLowerCase()) {
			case 'in-progress': return 'In Progress';
			case 'not-started': return 'Not Started';
			case 'submitted': return 'Submitted';
			case 'overdue': return 'Overdue';
			default: return status;
		}
	}

	private _formatDueDate(dueDate: string): string {
		try {
			const date = new Date(dueDate);
			return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
		} catch {
			return dueDate;
		}
	}

	private async _initialize(): Promise<void> {
		const isAuthed = await hasStoredStudentAuth(this.secretStorageService);
		if (!isAuthed) {
			this._renderSignInPrompt();
			this._startAuthWatcher();
			return;
		}

		console.log('CHAT INITIALIZED - User is authenticated');

		this._createLayout();
		await this._loadChatHistory();
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
		this._messageDisposables.push(renderedMarkdown); // track for disposal
		append(contentElement, renderedMarkdown.element);

		// add user/AI specific classes
		if (message.isUser || message.sender_type === 'student') {
			messageElement.classList.add('user-message');
		} else {
			messageElement.classList.add('ai-message');
		}

		// scroll to bottom
		this._scrollToBottom();
	}

	private _disposeAllMessageDisposables(): void {
		for (const disposable of this._messageDisposables) {
			disposable.dispose();
		}
		this._messageDisposables = [];
	}

	private async _loadChatHistory(): Promise<void> {
		// Show loading conversations message
		this._showEmptyChatMessage('Loading conversations...');
		try {
			const currentAssignment = this.studentService.getCurrentAssignment();
			if (!currentAssignment) {
				this._showEmptyChatMessage('Select an assignment to view chat history.');
				return;
			}
			const history = await this.studentService.getChatHistory();
			if (!history || history.length === 0) {
				this._showEmptyChatMessage('No chat history yet for this assignment.');
				return;
			}
			// Clear loading message before rendering messages
			this._disposeAllMessageDisposables();
			while (this._messagesContainer.firstChild) {
				this._messagesContainer.removeChild(this._messagesContainer.firstChild);
			}
			history.forEach(message => this._addMessage(message));
		} catch (error) {
			console.error('Failed to load chat history:', error);
			this._showEmptyChatMessage('Failed to load chat history.');
		}
	}

	private _showEmptyChatMessage(text: string): void {
		this._disposeAllMessageDisposables();

		// Clear messages container
		while (this._messagesContainer.firstChild) {
			this._messagesContainer.removeChild(this._messagesContainer.firstChild);
		}
		const emptyMsg = document.createElement('div');
		emptyMsg.className = 'chat-empty-message';
		emptyMsg.textContent = text;
		this._messagesContainer.appendChild(emptyMsg);
	}

	private _renderSignInPrompt(): void {
		// Clear container and show sign-in CTA
		while (this._chatContainer.firstChild) {
			this._chatContainer.removeChild(this._chatContainer.firstChild);
		}

		const wrapper = append(this._chatContainer, $('.student-auth-required.empty-state-signed-out'));
		append(wrapper, $('span.empty-state-icon' + ThemeIcon.asCSSSelector(Codicon.commentDiscussion)));
		const hint = append(wrapper, $('.student-auth-hint'));
		hint.textContent = localize('studentAuthHint', "Not signed in yet");
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
			this._disposeAllMessageDisposables();

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

