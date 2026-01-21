/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ApiClient } from './apiClients.js';
import { AdaptRequest } from './types.js';
// import { AdaptRequest, SubmitWorkPayload, StudentSettings } from './types.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ensureStudentAuth } from '../common/studentAuth.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';

export interface IStudentProgress {
	studentId: string;
	completionRate: number;
	skillLevels: Record<string, number>;
	currentStreak: number;
	totalExercises: number;
	completedExercises: number;
	lastActivity: Date;
}

export interface IStudentTask {
	id: string;
	title: string;
	description: string;
	difficulty: 'beginner' | 'intermediate' | 'advanced';
	estimatedTime: number;
	completed: boolean;
	dueDate?: Date;
	topic: string;
}

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
	readonly onProgressUpdate: Event<IStudentProgress>;
	readonly onTasksUpdate: Event<IStudentTask[]>;
	readonly onChatMessage: Event<IChatMessage>;

	// Progress methods
	getProgress(): Promise<IStudentProgress>;
	updateProgress(data: Partial<IStudentProgress>): Promise<void>;

	// Task methods
	getTasks(): Promise<IStudentTask[]>;
	completeTask(taskId: string): Promise<void>;
	getTaskById(taskId: string): Promise<IStudentTask | undefined>;

	// Chat methods
	sendChatMessage(message: string): Promise<IChatMessage>;
	getChatHistory(): Promise<IChatMessage[]>;
	clearChatHistory(): Promise<void>;

	// Settings
	resetProgress(): Promise<void>;
	// getSettings(): Promise<StudentSettings>;
	// updateSettings(settings: StudentSettings): Promise<void>;
}

export class StudentService extends Disposable implements IStudentService {
	declare readonly _serviceBrand: undefined;

	private readonly _onProgressUpdate = this._register(new Emitter<IStudentProgress>());
	readonly onProgressUpdate: Event<IStudentProgress> = this._onProgressUpdate.event;

	private readonly _onTasksUpdate = this._register(new Emitter<IStudentTask[]>());
	readonly onTasksUpdate: Event<IStudentTask[]> = this._onTasksUpdate.event;

	private readonly _onChatMessage = this._register(new Emitter<IChatMessage>());
	readonly onChatMessage: Event<IChatMessage> = this._onChatMessage.event;

	private _apiClient: ApiClient;
	private _initialized = false;
	private _studentId: string | undefined;
	private _currentProgress: IStudentProgress = {
		studentId: '',
		completionRate: 0,
		skillLevels: {},
		currentStreak: 0,
		totalExercises: 0,
		completedExercises: 0,
		lastActivity: new Date(0),
	};
	private _currentTasks: IStudentTask[] = [];
	private _chatHistory: IChatMessage[] = [];

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ICommandService private readonly commandService: ICommandService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
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

			const [progress, tasks] = await Promise.all([
				this._fetchProgressSafe(),
				this._fetchTasksSafe()
			]);

			this._currentProgress = progress;
			this._currentTasks = tasks;
		} catch (error) {
			console.error('Failed to initialize StudentService:', error);
			return;
		}

		this._initialized = true;
	}

	private async ensureApiClient(): Promise<ApiClient | undefined> {
		// Ensure the student is authenticated (prompts once; backend manages session/token).
		const result = await ensureStudentAuth(this.quickInputService, this.commandService, this._apiClient);
		if (!result) {
			return;
		}
		this._studentId = result.studentId ?? this._studentId;
		return this._apiClient;
	}

	private async _fetchProgressSafe(): Promise<IStudentProgress> {
		try {
			const response = await this._apiClient.get<IStudentProgress>('/student/progress');
			return response.data;
		} catch (error) {
			console.error('Failed to fetch student progress:', error);
			return this._currentProgress;
		}
	}

	private async _fetchTasksSafe(): Promise<IStudentTask[]> {
		try {
			const response = await this._apiClient.get<IStudentTask[]>('/student/tasks');
			return response.data;
		} catch (error) {
			console.error('Failed to fetch student tasks:', error);
			return [];
		}
	}

	async getProgress(): Promise<IStudentProgress> {
		await this._ensureInitialized();
		try {
			const response = await this._apiClient.get<IStudentProgress>('/student/progress');
			this._currentProgress = response.data;
			return response.data;
		} catch (error) {
			console.error('Failed to fetch student progress:', error);
			return this._currentProgress;
		}
	}

	async updateProgress(data: Partial<IStudentProgress>): Promise<void> {
		await this._ensureInitialized();
		try {
			const response = await this._apiClient.put<IStudentProgress>('/student/progress', data);
			this._currentProgress = response.data;
			this._onProgressUpdate.fire(this._currentProgress);
		} catch (error) {
			console.error('Failed to update student progress:', error);
			throw error;
		}
	}

	async getTasks(): Promise<IStudentTask[]> {
		await this._ensureInitialized();
		try {
			const response = await this._apiClient.get<IStudentTask[]>('/student/tasks');
			this._currentTasks = response.data;
			return this._currentTasks;
		} catch (error) {
			console.error('Failed to fetch student tasks:', error);
			return this._currentTasks;
		}
	}

	async completeTask(taskId: string): Promise<void> {
		await this._ensureInitialized();
		try {
			await this._apiClient.post(`/student/tasks/${taskId}/complete`, {});

			const taskIndex = this._currentTasks.findIndex(task => task.id === taskId);
			if (taskIndex !== -1) {
				this._currentTasks[taskIndex].completed = true;
				this._onTasksUpdate.fire(this._currentTasks);
			}

			await this.getProgress();
			this._onProgressUpdate.fire(this._currentProgress);
		} catch (error) {
			console.error('Failed to complete task:', error);
			throw error;
		}
	}

	async getTaskById(taskId: string): Promise<IStudentTask | undefined> {
		await this._ensureInitialized();
		return this._currentTasks.find(task => task.id === taskId);
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
			};

			const response = await this._apiClient.adapt(payload);
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

	async resetProgress(): Promise<void> {
		await this._ensureInitialized();
		try {
			await this._apiClient.post('/student/reset', {});

			await Promise.all([
				this.getProgress(),
				this.getTasks()
			]);

			this._onProgressUpdate.fire(this._currentProgress);
			this._onTasksUpdate.fire([...this._currentTasks]);

			this._chatHistory = [];
		} catch (error) {
			console.error('Failed to reset progress:', error);
			throw error;
		}
	}
}

export const IStudentService = createDecorator<IStudentService>('studentService');
