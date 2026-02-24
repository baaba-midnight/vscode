/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Alias for assignment details
export type IStudentAssignment = import('./types.js').AssignmentDetails;

import { ChatMessage, AssignmentDetails, AdaptRequest } from './types.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ApiClient, IApiResponse } from './apiClients.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IStudentAuthService, AuthState, STUDENT_AUTH_STUDENT_ID_KEY } from '../../studentAuthentication/common/studentAuth.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

const ACTIVE_ASSIGNMENT_CONTEXT_KEY = 'student.activeAssignmentContext';

// Local definition for IChatMessage (frontend type)
export interface IChatMessage {
	id: string;
	content: string;
	isUser: boolean;
	timestamp: Date;
	metadata?: Record<string, string | number | boolean>;
	sender_type?: 'student' | 'system';
}

export interface ICurrentAssignmentContext {
	assignmentId: string;
	title: string;
	courseName?: string;
	status?: string;
	dueDate?: string;
}

export interface IStudentService {
	readonly _serviceBrand: undefined;

	// Events
	readonly onAssignmentsUpdate: Event<IStudentAssignment[]>;
	readonly onChatMessage: Event<IChatMessage>;
	readonly onCurrentAssignmentChange: Event<ICurrentAssignmentContext | undefined>;

	// Preload Student Context
	preloadStudentContext(): Promise<void>;

	// Assignment methods
	getAssignments(): Promise<IStudentAssignment[]>;
	getAssignmentById(assignmentId: string): Promise<IStudentAssignment | undefined>;
	submitAssignment(assignmentId: string, fileUris: string[]): Promise<void>;
	submitReflection(assignmentId: string, confidence: number, difficulty: string, text?: string): Promise<void>;
	setCurrentAssignment(context: ICurrentAssignmentContext | undefined): void;
	getCurrentAssignment(): string | undefined;
	getCurrentAssignmentContext(): ICurrentAssignmentContext | undefined;

	// Chat methods
	sendChatMessage(message: string): Promise<IChatMessage>;
	getChatHistory(): Promise<IChatMessage[]>;
	clearChatHistory(): Promise<void>;

	// getSettings(): Promise<StudentSettings>;
	// updateSettings(settings: StudentSettings): Promise<void>;
}

export class StudentService extends Disposable implements IStudentService {

	/**
	 * Convert a backend ChatMessage to a frontend IChatMessage.
	 */
	private _toIChatMessage(msg: ChatMessage): IChatMessage {
		return {
			id: msg.chat_id,
			content: msg.message_text,
			isUser: msg.sender_type === 'student',
			timestamp: new Date(msg.created_at),
			metadata: {},
			sender_type: msg.sender_type === 'student' ? 'student' : 'system',
		};
	}
	declare readonly _serviceBrand: undefined;

	private readonly _onAssignmentsUpdate = this._register(new Emitter<IStudentAssignment[]>());
	readonly onAssignmentsUpdate: Event<IStudentAssignment[]> = this._onAssignmentsUpdate.event;

	private readonly _onChatMessage = this._register(new Emitter<IChatMessage>());
	readonly onChatMessage: Event<IChatMessage> = this._onChatMessage.event;

	private readonly _onCurrentAssignmentChange = this._register(new Emitter<ICurrentAssignmentContext | undefined>());
	readonly onCurrentAssignmentChange: Event<ICurrentAssignmentContext | undefined> = this._onCurrentAssignmentChange.event;

	private _apiClient: ApiClient;
	private _initialized = false;
	private preloadPromise: Promise<void> | null = null;
	private _studentId: string | undefined;
	private _currentAssignments: IStudentAssignment[] = [];
	private _currentAssignmentContext: ICurrentAssignmentContext | undefined;
	private _chatHistory: IChatMessage[] = [];
	private _fetchedAssignmentDetails = new Set<string>();

	private _normalizeAssignmentsResponse(raw: unknown): IStudentAssignment[] {
		if (Array.isArray(raw)) {
			return raw as IStudentAssignment[];
		}
		if (raw && typeof raw === 'object') {
			const obj = raw as { assignments?: unknown; data?: unknown };
			if (Array.isArray(obj.assignments)) {
				return obj.assignments as IStudentAssignment[];
			}
			if (Array.isArray(obj.data)) {
				return obj.data as IStudentAssignment[];
			}
		}
		return [];
	}

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ICommandService private readonly commandService: ICommandService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@IStudentAuthService private readonly authService: IStudentAuthService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super();
		const baseURL = this.configurationService.getValue<string>('student.apiBaseUrl') || 'http://127.0.0.1:8000/api';
		this._apiClient = new ApiClient(this.commandService, baseURL);
		// Don't initialize immediately - let it happen lazily

		// Clear cache when user logs out so next login fetches fresh data
		this._register(authService.onDidAuthStateChange(state => {
			if (state === AuthState.Unauthenticated) {
				this.clearCache();
			}
		}));
	}

	/**
	 * Clear assignments and chat cache. Called on logout so next login fetches fresh data.
	 */
	private clearCache(): void {
		this._initialized = false;
		this.preloadPromise = null;
		this._currentAssignments = [];
		this._currentAssignmentContext = undefined;
		this._chatHistory = [];
		this._fetchedAssignmentDetails.clear();
		this._studentId = undefined;
		this.storageService.remove(ACTIVE_ASSIGNMENT_CONTEXT_KEY, StorageScope.APPLICATION);
	}

	private async _ensureInitialized(): Promise<void> {
		if (this._initialized) {
			return;
		}

		try {
			// Ensure we have a valid API client with authentication
			if (await this.ensureAuthenticated()) {
				this._currentAssignments = await this._fetchAssignmentsSafe();
			}
		} catch (error) {
			console.error('Failed to initialize StudentService:', error);
			return;
		}

		this._initialized = true;
	}

	private async _withAuthRetry<T>(operation: () => Promise<IApiResponse<T>>): Promise<IApiResponse<T>> {
		// Ensure we have a token before the first attempt
		await this.ensureAuthenticated();
		let response = await operation();
		if (!response.success && response.status === 401) {
			const refreshed = await this.authService.refreshAccessToken();
			if (refreshed && await this.ensureAuthenticated()) {
				response = await operation();
			}
		}
		return response;
	}

	private async ensureAuthenticated(): Promise<boolean> {
		// Wait for auth service to be ready
		await this.authService.whenReady();

		if (this.authService.state !== AuthState.Authenticated) {
			console.warn('StudentService: Not authenticated');
			return false;
		}

		const token = await this.authService.getValidAccessToken();
		if (!token) {
			console.warn('StudentService: No valid access token');
			return false;
		}

		this._apiClient.setAuthToken(token);

		// Try to load the student id from storage if we don't have it yet
		if (!this._studentId) {
			this._studentId = await this.secretStorageService.get(STUDENT_AUTH_STUDENT_ID_KEY) ?? this._studentId;
		}

		return true;
	}

	async preloadStudentContext(): Promise<void> {
		if (this.preloadPromise) {
			return this.preloadPromise;
		}

		this.preloadPromise = (async () => {
			// Ensure there is an authenticated client; stored auth will be reused if present
			const authed = await this.ensureAuthenticated();
			if (!authed) {
				return;
			}

			// warm up core data in parallel
			await Promise.allSettled([
				this.getAssignments(),
				// this.getChatHistory()
			]);
		})();

		try {
			await this.preloadPromise;
		} finally {
			this.preloadPromise = null;
		}
	}

	private async _fetchAssignmentsSafe(): Promise<IStudentAssignment[]> {
		try {
			const response = await this._withAuthRetry(() => this._apiClient.get<AssignmentDetails[]>('/student/assignments'));
			return this._normalizeAssignmentsResponse(response.data);
		} catch (error) {
			console.error('Failed to fetch student assignments:', error);
			return [];
		}
	}

	async getAssignments(): Promise<IStudentAssignment[]> {
		await this._ensureInitialized();
		try {
			const response = await this._withAuthRetry(() => this._apiClient.get<AssignmentDetails[]>('/student/assignments'));
			this._currentAssignments = this._normalizeAssignmentsResponse(response.data);
			return this._currentAssignments;
		} catch (error) {
			console.error('Failed to fetch student assignments:', error);
			return this._currentAssignments;
		}
	}

	async getAssignmentById(assignmentId: string): Promise<IStudentAssignment | undefined> {
		await this._ensureInitialized();
		// Prefer cached assignment. If we've already fetched details once for this
		// assignment in this session, avoid calling the backend again.
		const existing = this._currentAssignments.find(assignment => assignment.assignment_id === assignmentId);
		if (existing && (existing.files && existing.files.length || this._fetchedAssignmentDetails.has(assignmentId))) {
			return existing;
		}

		try {
			const response = await this._withAuthRetry(() => this._apiClient.get<AssignmentDetails>(`/student/assignments/${assignmentId}`));
			const detailed = response.data;
			this._fetchedAssignmentDetails.add(detailed.assignment_id);
			const index = this._currentAssignments.findIndex(a => a.assignment_id === detailed.assignment_id);
			if (index !== -1) {
				this._currentAssignments[index] = detailed;
				this._onAssignmentsUpdate.fire(this._currentAssignments);
			} else {
				this._currentAssignments.push(detailed);
				this._onAssignmentsUpdate.fire(this._currentAssignments);
			}
			return detailed;
		} catch (error) {
			console.error('Failed to fetch assignment details:', error);
			return existing;
		}
	}

	async submitAssignment(assignmentId: string, fileUris: string[]): Promise<void> {
		await this._ensureInitialized();
		try {
			const payload = {
				multipart: true,
				fields: {
					assignment_id: assignmentId
				},
				files: fileUris.map(uri => ({
					fieldName: 'files',
					uri
				}))
			};
			console.log('Submitting assignment payload:', payload);
			await this._withAuthRetry(() => this._apiClient.post<void>('/student/assignments/submit-assignment', payload));
		} catch (error) {
			console.error('Failed to submit assignment:', error);
			throw error;
		}
	}

	async submitReflection(assignmentId: string, confidence: number, difficulty: string, text?: string): Promise<void> {
		await this._ensureInitialized();
		try {

			const payload = {
				assignment_id: assignmentId,
				reflection_text: text ?? ''
			};
			await this._withAuthRetry(() => this._apiClient.post<void>('/student/reflections', payload));
		} catch (error) {
			console.error('Failed to submit reflection:', error);
			throw error;
		}
	}

	setCurrentAssignment(context: ICurrentAssignmentContext | undefined): void {
		this._currentAssignmentContext = context;

		if (context) {
			this.storageService.store(
				ACTIVE_ASSIGNMENT_CONTEXT_KEY,
				JSON.stringify(context),
				StorageScope.APPLICATION,
				StorageTarget.MACHINE
			);
		} else {
			this.storageService.remove(ACTIVE_ASSIGNMENT_CONTEXT_KEY, StorageScope.APPLICATION);
		}

		this._onCurrentAssignmentChange.fire(context);
	}

	getCurrentAssignment(): string | undefined {
		return this._getCurrentAssignmentContext()?.assignmentId;
	}

	getCurrentAssignmentContext(): ICurrentAssignmentContext | undefined {
		return this._getCurrentAssignmentContext();
	}

	private _getCurrentAssignmentContext(): ICurrentAssignmentContext | undefined {
		if (this._currentAssignmentContext) {
			return this._currentAssignmentContext;
		}

		try {
			const stored = this.storageService.get(ACTIVE_ASSIGNMENT_CONTEXT_KEY, StorageScope.APPLICATION);
			if (stored) {
				this._currentAssignmentContext = JSON.parse(stored) as ICurrentAssignmentContext;
				return this._currentAssignmentContext;
			}
		} catch {
			console.error('Failed to parse stored assignment context');
		}
		return undefined;
	}

	async sendChatMessage(message: string): Promise<IChatMessage> {
		await this._ensureInitialized();
		try {
			const userMessage: IChatMessage = {
				id: Date.now().toString(),
				content: message,
				isUser: true,
				timestamp: new Date(),
			};

			this._chatHistory.push(userMessage);
			this._onChatMessage.fire(userMessage);

			const payload: AdaptRequest = {
				student_id: this._studentId ?? '',
				student_query: message,
				reflection: null,
				task_result: null,
				assignment_id: this._currentAssignmentContext?.assignmentId ?? null,
			};

			const response = await this._withAuthRetry(() => this._apiClient.adapt(payload));
			const aiText = response.data.ai_response ?? 'Sorry, no reply available.';

			const aiMessage: IChatMessage = {
				id: (Date.now() + 1).toString(),
				content: aiText,
				isUser: false,
				timestamp: new Date(),
			};

			this._chatHistory.push(aiMessage);
			this._onChatMessage.fire(aiMessage);

			return aiMessage;
		} catch (error) {
			console.error('Failed to send chat message:', error);

			const errorMessage: IChatMessage = {
				id: (Date.now() + 2).toString(),
				content: 'Sorry, I encountered an error while processing your message. Please try again later.',
				isUser: false,
				timestamp: new Date()
			};

			this._chatHistory.push(errorMessage);
			this._onChatMessage.fire(errorMessage);

			return errorMessage;
		}
	}

	async getChatHistory(): Promise<IChatMessage[]> {
		await this._ensureInitialized();
		try {
			// Fetch from backend route
			const response = await this._withAuthRetry(() => this._apiClient.get<ChatMessage[]>(`/chat/${this._currentAssignmentContext?.assignmentId}`));
			if (response.success && Array.isArray(response.data)) {
				this._chatHistory = response.data.map(msg => this._toIChatMessage(msg));
				return [...this._chatHistory];
			} else {
				return [...this._chatHistory];
			}
		} catch (error) {
			console.error('Failed to fetch chat history from backend:', error);
			return [...this._chatHistory];
		}
	}

	async clearChatHistory(): Promise<void> {
		this._chatHistory = [];
	}
}

export const IStudentService = createDecorator<IStudentService>('studentService');
