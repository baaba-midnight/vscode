/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ApiClient, IApiResponse } from './apiClients.js';
import { AdaptRequest, AssignmentDetails } from './types.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ensureStudentAuth, refreshStudentAuth } from '../common/studentAuth.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';

export interface IStudentAssignment extends AssignmentDetails { }

export interface IChatMessage {
	id: string;
	content: string;
	isUser: boolean;
	timestamp: Date;
	metadata?: Record<string, string | number | boolean>;
}

export interface IStudentService {
	readonly _serviceBrand: undefined;

	// Events
	readonly onAssignmentsUpdate: Event<IStudentAssignment[]>;
	readonly onChatMessage: Event<IChatMessage>;

	// Preload Student Context
	preloadStudentContext(): Promise<void>;

	// Assignment methods
	getAssignments(): Promise<IStudentAssignment[]>;
	getAssignmentById(assignmentId: string): Promise<IStudentAssignment | undefined>;
	submitAssignment(assignmentId: string, fileUris: string[]): Promise<void>;
	submitReflection(assignmentId: string, confidence: number, difficulty: string, text?: string): Promise<void>;
	setCurrentAssignment(assignmentId: string | undefined): void;
	getCurrentAssignment(): string | undefined;

	// Chat methods
	sendChatMessage(message: string): Promise<IChatMessage>;
	getChatHistory(): Promise<IChatMessage[]>;
	clearChatHistory(): Promise<void>;

	// getSettings(): Promise<StudentSettings>;
	// updateSettings(settings: StudentSettings): Promise<void>;
}

export class StudentService extends Disposable implements IStudentService {
	declare readonly _serviceBrand: undefined;

	private readonly _onAssignmentsUpdate = this._register(new Emitter<IStudentAssignment[]>());
	readonly onAssignmentsUpdate: Event<IStudentAssignment[]> = this._onAssignmentsUpdate.event;

	private readonly _onChatMessage = this._register(new Emitter<IChatMessage>());
	readonly onChatMessage: Event<IChatMessage> = this._onChatMessage.event;

	private _apiClient: ApiClient;
	private _initialized = false;
	private preloadPromise: Promise<void> | null = null;
	private _studentId: string | undefined;
	private _currentAssignments: IStudentAssignment[] = [];
	private _currentAssignmentId: string | undefined;
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
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
	) {
		super();
		const baseURL = this.configurationService.getValue<string>('student.apiBaseUrl') || 'http://127.0.0.1:8000/api';
		this._apiClient = new ApiClient(this.commandService, baseURL);
		// Don't initialize immediately - let it happen lazily
	}

	private async _ensureInitialized(): Promise<void> {
		if (this._initialized) {
			return;
		}

		try {
			// ensure we have a valid API client with authentication
			await this.ensureApiClient();

			this._currentAssignments = await this._fetchAssignmentsSafe();
		} catch (error) {
			console.error('Failed to initialize StudentService:', error);
			return;
		}

		this._initialized = true;
	}

	private async _withAuthRetry<T>(operation: () => Promise<IApiResponse<T>>): Promise<IApiResponse<T>> {
		let response = await operation();
		if (!response.success && response.status === 401) {
			const refreshed = await refreshStudentAuth(this.commandService, this._apiClient, this.secretStorageService);
			if (refreshed?.authToken) {
				response = await operation();
			}
		}
		return response;
	}

	private async ensureApiClient(): Promise<ApiClient | undefined> {
		// Ensure the student is authenticated (prompts once; backend manages session/token).
		const result = await ensureStudentAuth(this.quickInputService, this.commandService, this._apiClient, this.secretStorageService);
		if (!result) {
			return;
		}
		this._studentId = result.studentId ?? this._studentId;
		return this._apiClient;
	}

	async preloadStudentContext(): Promise<void> {
		if (this.preloadPromise) {
			return this.preloadPromise;
		}

		this.preloadPromise = (async () => {
			// ensure there is an authicated client; the stored aith will be reused if present
			await this.ensureApiClient();

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

	setCurrentAssignment(assignmentId: string | undefined): void {
		this._currentAssignmentId = assignmentId;
	}

	getCurrentAssignment(): string | undefined {
		return this._currentAssignmentId;
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
				assignment_id: this._currentAssignmentId ?? null,
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
		return [...this._chatHistory];
	}

	async clearChatHistory(): Promise<void> {
		this._chatHistory = [];
	}
}

export const IStudentService = createDecorator<IStudentService>('studentService');
