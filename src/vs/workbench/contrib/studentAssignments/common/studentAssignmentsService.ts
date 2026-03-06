/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ApiClient } from '../../studentAssignments/common/apiClients.js';
import { CourseResponse, AssignmentResponse, AssignmentFile, ISubmissionFile } from './types.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IRequestService } from '../../../../platform/request/common/request.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { streamToBuffer } from '../../../../base/common/buffer.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { withAuthRetry } from '../../studentAuthentication/common/authUtils.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceEditingService } from '../../../services/workspaces/common/workspaceEditing.js';
import { IStudentAuthService, AuthState } from '../../studentAuthentication/common/studentAuth.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

export const IStudentAssignmentsService = createDecorator<IStudentAssignmentsService>('studentAssignmentsService');
const ACTIVE_ASSIGNMENTS_FOLDER_KEY = 'student.activeAssignmentsFolderUri';

export enum CourseStatus {
	Active = 'active',
	Completed = 'completed',
	Archived = 'archived'
}

export enum AssignmentStatus {
	NotStarted = 'not-started',
	InProgress = 'in-progress',
	Submitted = 'submitted',
	Overdue = 'overdue'
}

export interface ICourse {
	id: string;
	name: string;
	code?: string;
	instructor: string;
	term: string;
	description?: string;
	color?: string;
	status: CourseStatus;
	assignmentCount: number;
	subject?: string;
}

export interface IAssignment {
	id: string;
	courseId: string;
	title: string;
	description: string;
	instructions: string;
	requirements: string[];
	status: AssignmentStatus;
	dueDate: Date | string;
	points: number;
	type: string; // 'Project', 'Exercise', 'Lab', etc.
	files: IAssignmentFile[];
}

export interface IAssignmentFile {
	name: string;
	size: string;
	type: string; // file extension
	required: boolean;
	downloadUrl: string;
}

export interface ISubmission {
	assignmentId: string;
	submitted: boolean;
	submittedAt: Date | null;
	score: number | null;
	feedback?: string;
	gradedAt: Date | null;
	files: ISubmissionFile[];
}

interface ISubmissionResponseFile {
	filename: string;
	mime_type: string;
	download_url: string;
}

interface ISubmissionResponse {
	assignment_id: string;
	submitted: boolean;
	submitted_at: string | null;
	score: number | null;
	feedback?: string;
	graded_at: string | null;
	files: ISubmissionResponseFile[];
}

interface DownloadResult {
	downloaded: number;
	skipped: number;
	failed: { name: string; reason: string }[];
}

/**
 * Service for managing student assignments and courses
 */
export interface IStudentAssignmentsService {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when courses change
	 */
	readonly onDidChangeCourses: Event<void>;

	/**
	 * Event fired when assignments change
	 */
	readonly onDidChangeAssignments: Event<string>; // courseId

	/**
	 * Get all courses for the current user
	 */
	getCourses(): Promise<ICourse[]>;

	/**
	 * Get a specific course by ID
	 */
	getCourse(courseId: string): Promise<ICourse | undefined>;

	/**
	 * Get all assignments for a specific course
	 */
	getAssignmentsByCourse(courseId: string): Promise<IAssignment[]>;

	/**
	 * Get a specific assignment by ID
	 */
	getAssignment(assignmentId: string): Promise<IAssignment | undefined>;

	/**
	 * Start an assignment (download files, update status)
	 */
	startAssignment(assignmentId: string): Promise<void>;

	/**
	 * Submit an assignment
	 */
	submitAssignment(assignmentId: string, files: ISubmissionFile[]): Promise<void>;

	/**
	 * Get submission for an assignment
	 */
	getSubmission(assignmentId: string): Promise<ISubmission | undefined>;

	/**
	 * Open assignment folder in explorer
	 */
	openAssignmentFolder(assignmentId: string): Promise<void>;

	/**
	 * Open an assignment as a single-folder workspace in a new window
	 */
	openAssignmentWorkspace(assignmentId: string): Promise<void>;

	/**
	 * Open course files folder
	 */
	openCourseFolder(courseId: string): Promise<void>;

	/**
	 * Refresh courses and assignments from server
	 */
	refresh(): Promise<void>;
}

/**
 * Implementation of IStudentAssignmentsService
 */
export class StudentAssignmentsService implements IStudentAssignmentsService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeCourses = new Emitter<void>();
	readonly onDidChangeCourses: Event<void> = this._onDidChangeCourses.event;

	private readonly _onDidChangeAssignments = new Emitter<string>();
	readonly onDidChangeAssignments: Event<string> = this._onDidChangeAssignments.event;

	private courses: ICourse[] = [];
	private assignments: Map<string, IAssignment[]> = new Map();
	private readonly apiClient: ApiClient;
	private assignmentsRootWorkspaceEnsured = false;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ICommandService private readonly commandService: ICommandService,
		@IStudentAuthService private readonly authService: IStudentAuthService,
		@IFileService private readonly fileService: IFileService,
		@IPathService private readonly pathService: IPathService,
		@IRequestService private readonly requestService: IRequestService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IWorkspaceEditingService private readonly workspaceEditingService: IWorkspaceEditingService,
		@INotificationService private readonly notificationService: INotificationService,
		@IStorageService private readonly storageService: IStorageService
	) {
		const baseURL = this.configurationService.getValue<string>('student.apiBaseUrl') || 'https://capstone-api-t3k3.onrender.com/api';
		this.apiClient = new ApiClient(baseURL);

		// Clear cache when user logs out so next login fetches fresh data
		authService.onDidAuthStateChange(state => {
			if (state === AuthState.Unauthenticated) {
				this.clearCache();
			}
		});

		console.log('[StudentAssignmentsService] Service initialized');
	}

	/**
	 * Clear courses and assignments cache. Called on logout so next login fetches fresh data.
	 */
	clearCache(): void {
		const hadData = this.courses.length > 0 || this.assignments.size > 0;
		this.courses = [];
		this.assignments.clear();
		if (hadData) {
			this._onDidChangeCourses.fire();
			console.log('[StudentAssignmentsService] Cache cleared on logout');
		}
	}

	/**
	 * Ensure the user is authenticated before making API calls
	 */
	private async ensureAuthenticated(): Promise<boolean> {
		// Wait for auth service to be ready
		await this.authService.whenReady();

		// Check if authenticated
		if (this.authService.state !== AuthState.Authenticated) {
			console.warn('[StudentAssignmentsService] Not authenticated');
			return false;
		}

		// Get valid access token (will refresh if needed)
		const token = await this.authService.getValidAccessToken();
		if (!token) {
			console.warn('[StudentAssignmentsService] No valid access token');
			return false;
		}

		// Set token in API client
		this.apiClient.setAuthToken(token);
		return true;
	}

	async getCourses(): Promise<ICourse[]> {
		if (!await this.ensureAuthenticated()) {
			return this.courses; // Return cached courses if not authenticated
		}

		if (!this.courses.length) {
			await this.fetchCourses();
		}

		return this.courses;
	}

	async getCourse(courseId: string): Promise<ICourse | undefined> {
		if (!await this.ensureAuthenticated()) {
			return this.courses.find(c => c.id === courseId);
		}

		const existing = this.courses.find(c => c.id === courseId);
		if (existing) {
			return existing;
		}

		try {
			const response = await withAuthRetry(this.authService, () => this.apiClient.get<CourseResponse>(`/student/courses/${courseId}`));
			if (response.success && response.data) {
				const course = this.toCourse(response.data);
				this.courses.push(course);
				return course;
			}
		} catch (error) {
			console.error('[StudentAssignmentsService] Failed to fetch course details', error);

			// Handle 401 errors by attempting refresh
			if ((error).status === 401) {
				const refreshed = await this.authService.refreshAccessToken();
				if (refreshed) {
					// Retry after refresh
					return this.getCourse(courseId);
				}
			}
		}

		return undefined;
	}

	async getAssignmentsByCourse(courseId: string): Promise<IAssignment[]> {
		if (!await this.ensureAuthenticated()) {
			return this.assignments.get(courseId) || [];
		}

		if (!this.assignments.has(courseId)) {
			await this.fetchAssignmentsForCourse(courseId);
		}

		return this.assignments.get(courseId) || [];
	}

	async getAssignment(assignmentId: string): Promise<IAssignment | undefined> {
		if (!await this.ensureAuthenticated()) {
			// Search in cache
			for (const assignments of this.assignments.values()) {
				const found = assignments.find(a => a.id === assignmentId);
				if (found) {
					return found;
				}
			}
			return undefined;
		}

		// Search in cache first
		for (const assignments of this.assignments.values()) {
			const found = assignments.find(a => a.id === assignmentId);
			if (found) {
				return found;
			}
		}

		// Fetch from API
		try {
			const response = await withAuthRetry(this.authService, () => this.apiClient.get<AssignmentResponse>(`/student/assignments/${assignmentId}`));
			if (response.success && response.data) {
				const assignment = this.toAssignment(response.data);
				this.updateAssignmentCache(assignment);
				return assignment;
			}
		} catch (error) {
			console.error('[StudentAssignmentsService] Failed to fetch assignment details', error);

			// Handle 401 errors
			if ((error).status === 401) {
				const refreshed = await this.authService.refreshAccessToken();
				if (refreshed) {
					return this.getAssignment(assignmentId);
				}
			}
		}

		return undefined;
	}

	async startAssignment(assignmentId: string): Promise<void> {
		if (!await this.ensureAuthenticated()) {
			return;
		}

		const assignment = await this.getAssignment(assignmentId);
		if (!assignment) {
			return;
		}

		try {
			// Call backend to mark assignment as started
			await withAuthRetry(this.authService, () => this.apiClient.post(`/student/assignments/${assignmentId}/start`, {}));

			// Download assignment files
			await this.downloadAssignmentFiles(assignment);

			// Update local cache
			assignment.status = AssignmentStatus.InProgress;
			this.updateAssignmentCache(assignment);
			this._onDidChangeAssignments.fire(assignment.courseId);
		} catch (error) {
			console.error('[StudentAssignmentsService] Failed to start assignment', error);
			throw error;
		}
	}

	async submitAssignment(assignmentId: string, files: ISubmissionFile[]): Promise<void> {
		if (!await this.ensureAuthenticated()) {
			return;
		}

		if (files.length === 0) {
			this.notificationService.warn('No files selected for submission');
			return;
		}

		try {
			const formData = new FormData();

			for (const file of files) {
				console.log('[submit] file.filename:', file.filename);
				console.log('[submit] file.bytes:', file.bytes);
				console.log('[submit] file.bytes length:', file.bytes?.length);
				console.log('[submit] file.mimeType:', file.mimeType);

				if (!file.bytes) {
					console.warn('[submit] SKIPPING file - bytes falsy:', file.filename);
					continue;
				}

				const blob = new Blob([file.bytes as Uint8Array<ArrayBuffer>], { type: file.mimeType });
				console.log('[submit] blob size:', blob.size);
				formData.append('files', blob, file.filename);
			}

			// Verify FormData actually has entries
			let entryCount = 0;
			for (const [key, value] of formData.entries()) {
				console.log('[submit] formData entry:', key, value);
				entryCount++;
			}
			console.log('[submit] total formData entries:', entryCount);

			const response = await withAuthRetry(this.authService, () =>
				this.apiClient.postForm(`/student/assignments/${assignmentId}/submit`, formData)
			);


			if (!response.success || response.status !== 200) {
				// show notification assignment failed to be submitted
				this.notificationService.error('Failed to submit assignment. Please try again.');
				return;
			}

			// Update local cache
			const assignment = await this.getAssignment(assignmentId);
			if (assignment) {
				assignment.status = AssignmentStatus.Submitted;
				this.updateAssignmentCache(assignment);
				this._onDidChangeAssignments.fire(assignment.courseId);
			}
		} catch (error) {
			console.error('[StudentAssignmentsService] Failed to submit assignment', error);
			throw error;
		}
	}

	async getSubmission(assignmentId: string): Promise<ISubmission | undefined> {
		if (!await this.ensureAuthenticated()) {
			return undefined;
		}

		try {
			const response = await withAuthRetry(this.authService, () => this.apiClient.get<ISubmissionResponse>(`/student/assignments/${assignmentId}/submission`));
			if (response.success && response.data) {
				return this.toSubmission(response.data);
			}
		} catch (error) {
			console.error('[StudentAssignmentsService] Failed to fetch assignment submission', error);
		}

		return undefined;
	}

	async openAssignmentFolder(assignmentId: string): Promise<void> {
		console.log(`[StudentAssignmentsService] Opening folder for assignment ${assignmentId}`);

		if (!await this.ensureAuthenticated()) {
			return;
		}

		const assignment = await this.getAssignment(assignmentId);
		if (!assignment) {
			return;
		}

		try {
			const folderUri = await this.downloadAssignmentFiles(assignment);

			if (folderUri) {
				try {
					await this.commandService.executeCommand('revealInExplorer', folderUri);
				} catch (error) {
					// Fallback to OS file explorer if Explorer reveal fails
					await this.commandService.executeCommand('revealFileInOS', folderUri);
				}
			}
		} catch (error) {
			console.error('[StudentAssignmentsService] Failed to open assignment folder', error);
		}
	}

	async openAssignmentWorkspace(assignmentId: string): Promise<void> {
		console.log(`[StudentAssignmentsService] Opening workspace for assignment ${assignmentId}`);

		if (!await this.ensureAuthenticated()) {
			return;
		}

		const assignment = await this.getAssignment(assignmentId);
		if (!assignment) {
			return;
		}

		try {
			const folderUri = await this.downloadAssignmentFiles(assignment);
			if (!folderUri) {
				return;
			}

			// Persist the folder URI so it can be restored after the workspace reloads.
			// SetCurrentAssignment
			// window reload triggered by updateFolders wipes
			this.storageService.store(
				ACTIVE_ASSIGNMENTS_FOLDER_KEY,
				folderUri.toString(),
				StorageScope.APPLICATION,
				StorageTarget.MACHINE
			);

			// Replace whatever folder is currently in the workspace with this
			// assignment's folder

			const workspace = this.workspaceContextService.getWorkspace();
			const existingFolders = workspace.folders.map(f => f.uri);

			await this.workspaceEditingService.addFolders([{ uri: folderUri }], false);

			const toRemove = existingFolders.filter(uri => uri.toString() !== folderUri.toString());
			if (toRemove.length > 0) {
				await this.workspaceEditingService.removeFolders(toRemove, false);
			}
		} catch (error) {
			console.error('[StudentAssignmentsService] Failed to open assignment workspace', error);
		}
	}

	async openCourseFolder(courseId: string): Promise<void> {
		if (!await this.ensureAuthenticated()) {
			return;
		}

		const course = await this.getCourse(courseId);
		if (!course) {
			return;
		}

		try {
			const root = await this.getAssignmentsRootFolder();
			const courseFolder = joinPath(root, this.sanitizeName(course.name));
			await this.fileService.createFolder(courseFolder);

			try {
				await this.commandService.executeCommand('revealFileInOS', courseFolder);
			} catch (error) {
				console.error('[StudentAssignmentsService] Failed to reveal in OS, falling back to explorer', error);
				await this.commandService.executeCommand('revealInExplorer', courseFolder);
			}
		} catch (error) {
			console.error('[StudentAssignmentsService] Failed to open course folder', error);
		}
	}

	async refresh(): Promise<void> {
		if (!await this.ensureAuthenticated()) {
			return;
		}

		await this.fetchCourses();
		this.assignments.clear();
		this._onDidChangeCourses.fire();
	}

	private async fetchCourses(): Promise<void> {
		try {
			const response = await withAuthRetry(this.authService, () => this.apiClient.get<CourseResponse[]>('/student/courses'));

			if (response.success && response.data) {
				this.courses = response.data.map(course => this.toCourse(course));
				console.log(`[StudentAssignmentsService] Fetched ${this.courses.length} courses`);
				this._onDidChangeCourses.fire();
			}
		} catch (error) {
			console.error('[StudentAssignmentsService] Failed to fetch courses', error);

			// Handle 401
			if ((error).status === 401) {
				const refreshed = await this.authService.refreshAccessToken();
				if (refreshed) {
					await this.fetchCourses();
				}
			}
		}
	}

	private async fetchAssignmentsForCourse(courseId: string): Promise<void> {
		try {
			const response = await withAuthRetry(this.authService, () => this.apiClient.get<AssignmentResponse[]>(`/student/courses/${courseId}/assignments`));
			if (response.success && response.data) {
				const normalized = response.data.map(assignment => this.toAssignment(assignment));
				this.assignments.set(courseId, normalized);
				console.log(`[StudentAssignmentsService] Fetched ${normalized.length} assignments for course ${courseId}`);
			}
		} catch (error) {
			console.error('[StudentAssignmentsService] Failed to fetch assignments for course', error);

			// Handle 401
			if ((error).status === 401) {
				const refreshed = await this.authService.refreshAccessToken();
				if (refreshed) {
					await this.fetchAssignmentsForCourse(courseId);
				}
			}
		}
	}

	private toCourse(course: CourseResponse): ICourse {
		return {
			id: String(course.id),
			name: String(course.name),
			code: course.code ? String(course.code) : undefined,
			instructor: String(course.instructor_name),
			term: String(course.term),
			description: course.description ? String(course.description) : undefined,
			color: undefined,
			status: this.toCourseStatus(String(course.status)),
			assignmentCount: typeof course.assignment_count === 'number' ? course.assignment_count : 0,
			subject: undefined
		};
	}

	private toCourseStatus(status: string): CourseStatus {
		const normalized = status.toLowerCase();
		switch (normalized) {
			case CourseStatus.Active:
				return CourseStatus.Active;
			case CourseStatus.Completed:
				return CourseStatus.Completed;
			case CourseStatus.Archived:
				return CourseStatus.Archived;
			default:
				return CourseStatus.Active;
		}
	}

	private toAssignment(assignment: AssignmentResponse): IAssignment {
		const courseId = String(assignment.course_id);
		const status = this.toAssignmentStatus(String(assignment.status), Boolean(assignment.is_overdue));
		return {
			id: String(assignment.id),
			courseId,
			title: String(assignment.title),
			description: String(assignment.description),
			instructions: String(assignment.instructions),
			requirements: [],
			status,
			dueDate: String(assignment.due_date),
			points: assignment.points,
			type: 'Assignment',
			files: (assignment.files || []).map(file => this.toAssignmentFile(file))
		};
	}

	private toAssignmentStatus(status: string, isOverdue: boolean): AssignmentStatus {
		const normalized = status.toLowerCase().replace(/_/g, '-');
		switch (normalized) {
			case AssignmentStatus.NotStarted:
				return AssignmentStatus.NotStarted;
			case AssignmentStatus.InProgress:
				return AssignmentStatus.InProgress;
			case AssignmentStatus.Submitted:
				return AssignmentStatus.Submitted;
			case AssignmentStatus.Overdue:
				return AssignmentStatus.Overdue;
			default:
				return isOverdue ? AssignmentStatus.Overdue : AssignmentStatus.NotStarted;
		}
	}

	private toAssignmentFile(file: AssignmentFile): IAssignmentFile {
		return {
			name: String(file.filename),
			size: '',
			type: String(file.file_type),
			required: Boolean(file.is_required),
			downloadUrl: file.download_url ? String(file.download_url) : '',
		};
	}

	/**
	 * Download a list of files for an assignment. Returns an aggregated DownloadResult.
	 */
	private async downloadFiles(assignment: IAssignment, files: IAssignmentFile[]): Promise<DownloadResult> {
		const course = await this.getCourse(assignment.courseId);
		const folderUri = await this.getAssignmentFolderUri(assignment, course);
		await this.fileService.createFolder(folderUri);

		const result: DownloadResult = { downloaded: 0, skipped: 0, failed: [] };

		for (const file of files) {
			if (!file.downloadUrl) {
				result.skipped++;
				continue;
			}

			const targetUri = joinPath(folderUri, this.sanitizeName(file.name));

			if (await this.fileService.exists(targetUri)) {
				console.log(`[StudentAssignmentsService] File already exists, skipping download: ${file.name}`);
				result.skipped++;
				continue;
			}

			const cts = new CancellationTokenSource();
			const timeout = setTimeout(() => cts.cancel(), 30_000);

			try {
				const context = await this.requestService.request({ url: file.downloadUrl, type: 'GET' }, cts.token);
				const buffer = await streamToBuffer(context.stream);
				await this.fileService.writeFile(targetUri, buffer);
				console.log(`[StudentAssignmentsService] Downloaded file: ${file.name}`);
				result.downloaded++;
			} catch (error) {
				console.error('[StudentAssignmentsService] Failed to download assignment file', file.name, error);
				result.failed.push({ name: file.name, reason: error?.message || String(error) });
			} finally {
				clearTimeout(timeout);
				cts.dispose();
			}
		}

		return result;
	}

	private toSubmission(submission: ISubmissionResponse): ISubmission {
		return {
			assignmentId: String(submission.assignment_id),
			submitted: Boolean(submission.submitted),
			submittedAt: submission.submitted_at ? new Date(submission.submitted_at) : null,
			score: typeof submission.score === 'number' ? submission.score : null,
			feedback: submission.feedback,
			gradedAt: submission.graded_at ? new Date(submission.graded_at) : null,
			files: Array.isArray(submission.files)
				? submission.files.map(file => ({
					bytes: new Uint8Array(), // actual bytes would require downloading the file, which we can implement if needed
					filename: String(file.filename),
					mimeType: String(file.mime_type),
					url: String(file.download_url)
				}))
				: []
		};
	}

	private async getAssignmentsRootFolder(): Promise<URI> {
		const userHome = await this.pathService.userHome({ preferLocal: true });
		const root = joinPath(userHome, 'StudentAssignments');
		await this.ensureAssignmentsRootInWorkspace(root);
		return root;
	}

	private sanitizeName(name: string): string {
		const sanitized = name.replace(/[\\/:*?"<>|]/g, '_').trim();
		return sanitized || 'untitled';
	}

	private updateAssignmentCache(assignment: IAssignment): void {
		const existing = this.assignments.get(assignment.courseId) || [];
		const index = existing.findIndex(a => a.id === assignment.id);
		if (index >= 0) {
			existing[index] = assignment;
		} else {
			existing.push(assignment);
		}
		this.assignments.set(assignment.courseId, existing);
	}

	private async ensureAssignmentsRootInWorkspace(root: URI): Promise<void> {
		if (this.assignmentsRootWorkspaceEnsured) {
			return;
		}

		try {
			const workspace = this.workspaceContextService.getWorkspace();
			if (workspace.folders.some(folder => folder.uri.toString() === root.toString())) {
				this.assignmentsRootWorkspaceEnsured = true;
				return;
			}

			await this.workspaceEditingService.addFolders([{ uri: root }], true);
			this.assignmentsRootWorkspaceEnsured = true;
		} catch (error) {
			console.error('[StudentAssignmentsService] Failed to add StudentAssignments root to workspace', error);
		}
	}

	private async getAssignmentFolderUri(assignment: IAssignment, course: ICourse | undefined): Promise<URI> {
		const root = await this.getAssignmentsRootFolder();
		const courseSegment = this.sanitizeName(course ? course.name : assignment.courseId);
		const assignmentSegment = this.sanitizeName(assignment.title || assignment.id);
		return joinPath(root, courseSegment, assignmentSegment);
	}

	private async downloadAssignmentFiles(assignment: IAssignment): Promise<URI | undefined> {
		const result = await this.downloadFiles(assignment, assignment.files);

		if (result.failed.length > 0) {
			const msg = `Downloaded ${result.downloaded} files, ${result.failed.length} failed.`;
			const choices = [
				{
					label: 'Retry failed',
					run: async () => {
						const failedFiles = assignment.files.filter(f => result.failed.some(ff => ff.name === f.name));
						const retryResult = await this.downloadFiles(assignment, failedFiles);
						const retryMsg = `Retry: downloaded ${retryResult.downloaded}, ${retryResult.failed.length} still failed.`;
						this.notificationService.info(retryMsg);
					}
				},
				{
					label: 'Open folder',
					run: () => {
						this.getAssignmentFolderUri(assignment, undefined).then(uri => {
							this.commandService.executeCommand('revealFileInOS', uri);
						}).catch(() => { /* ignore */ });
					},
					isSecondary: true
				}
			];

			this.notificationService.prompt(Severity.Warning, msg, choices);
		}

		return this.getAssignmentFolderUri(assignment, await this.getCourse(assignment.courseId));
	}
}
