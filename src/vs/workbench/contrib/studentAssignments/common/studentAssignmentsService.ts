/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { ApiClient } from '../../student/common/apiClients.js';
import { CourseResponse, AssignmentResponse, AssignmentFile } from './types.js';
import { ensureStudentAuth } from '../../student/common/studentAuth.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IRequestService } from '../../../../platform/request/common/request.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { streamToBuffer } from '../../../../base/common/buffer.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceEditingService } from '../../../services/workspaces/common/workspaceEditing.js';

export const IStudentAssignmentsService = createDecorator<IStudentAssignmentsService>('studentAssignmentsService');

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

export interface ISubmissionFile {
	filename: string;
	mimeType: string;
	url: string;
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
	url: string;
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
	submitAssignment(assignmentId: string, fileUris: string[]): Promise<void>;

	/**
	 * Get submission for an assignment
	 */
	getSubmission(assignmentId: string): Promise<ISubmission | undefined>;

	/**
	 * Open assignment folder in explorer
	 */
	openAssignmentFolder(assignmentId: string): Promise<void>;

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
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@IFileService private readonly fileService: IFileService,
		@IPathService private readonly pathService: IPathService,
		@IRequestService private readonly requestService: IRequestService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IWorkspaceEditingService private readonly workspaceEditingService: IWorkspaceEditingService,
	) {
		const baseURL = this.configurationService.getValue<string>('student.apiBaseUrl') || 'http://127.0.0.1:8000/api';
		this.apiClient = new ApiClient(this.commandService, baseURL);
	}

	private async ensureInitialized(): Promise<boolean> {
		const authContext = await ensureStudentAuth(this.quickInputService, this.commandService, this.apiClient, this.secretStorageService);
		if (!authContext) {
			return false;
		}
		return true;
	}

	async getCourses(): Promise<ICourse[]> {
		if (!await this.ensureInitialized()) {
			return this.courses;
		}

		if (!this.courses.length) {
			await this.fetchCourses();
		}

		return this.courses;
	}

	async getCourse(courseId: string): Promise<ICourse | undefined> {
		if (!await this.ensureInitialized()) {
			return this.courses.find(c => c.id === courseId);
		}

		const existing = this.courses.find(c => c.id === courseId);
		if (existing) {
			return existing;
		}

		try {
			const response = await this.apiClient.get<CourseResponse>(`/student/courses/${courseId}`);
			const course = this.toCourse(response.data);
			this.courses.push(course);
			return course;
		} catch (error) {
			console.error('Failed to fetch course details', error);
			return undefined;
		}
	}

	async getAssignmentsByCourse(courseId: string): Promise<IAssignment[]> {
		if (!await this.ensureInitialized()) {
			return this.assignments.get(courseId) || [];
		}

		if (!this.assignments.has(courseId)) {
			await this.fetchAssignmentsForCourse(courseId);
		}

		return this.assignments.get(courseId) || [];
	}

	async getAssignment(assignmentId: string): Promise<IAssignment | undefined> {
		let cached: IAssignment | undefined;
		for (const assignments of this.assignments.values()) {
			const assignment = assignments.find(a => a.id === assignmentId);
			if (assignment) {
				cached = assignment;
				break;
			}
		}

		if (!await this.ensureInitialized()) {
			return cached;
		}

		try {
			const response = await this.apiClient.get<AssignmentResponse>(`/student/assignments/${assignmentId}`);
			const normalized = this.toAssignment(response.data);
			const existing = this.assignments.get(normalized.courseId) || [];
			if (!existing.some(a => a.id === normalized.id)) {
				existing.push(normalized);
				this.assignments.set(normalized.courseId, existing);
			} else {
				for (let i = 0; i < existing.length; i++) {
					if (existing[i].id === normalized.id) {
						existing[i] = normalized;
						break;
					}
				}
			}
			return normalized;
		} catch (error) {
			console.error('Failed to fetch assignment details', error);
			return cached;
		}
	}

	async startAssignment(assignmentId: string): Promise<void> {
		if (!await this.ensureInitialized()) {
			return;
		}

		const existingAssignment = await this.getAssignment(assignmentId);
		if (!existingAssignment) {
			return;
		}

		console.log(`[START ASSIGNMENT] ${assignmentId} | ${existingAssignment.title}`);

		try {
			// The start endpoint can return either a full AssignmentResponse or just an array of AssignmentFile
			const response = await this.apiClient.post<AssignmentResponse | AssignmentFile[]>(`/student/assignments/${assignmentId}/start`, {});
			let updatedAssignment: IAssignment | undefined;
			if (response && response.data) {

				console.log(`[START ASSIGNMENT] API response received for assignment ${assignmentId}`, JSON.stringify(response));

				const data = response.data as AssignmentResponse | AssignmentFile[];
				if (Array.isArray(data)) {
					// Backend returned just the files for this assignment
					const files = data.map(file => this.toAssignmentFile(file));
					updatedAssignment = {
						...existingAssignment,
						files
					};
					this.updateAssignmentCache(updatedAssignment);
				} else {
					// Backend returned a full assignment payload
					updatedAssignment = this.toAssignment(data);
					this.updateAssignmentCache(updatedAssignment);
				}
			} else {
				await this.fetchAssignmentsForCourse(existingAssignment.courseId);
				updatedAssignment = await this.getAssignment(assignmentId) || existingAssignment;
			}

			if (updatedAssignment) {
				await this.downloadAssignmentFiles(updatedAssignment);
				this._onDidChangeAssignments.fire(updatedAssignment.courseId);
			}
		} catch (error) {
			console.error('Failed to start assignment', error);
		}
	}

	async submitAssignment(assignmentId: string, fileUris: string[]): Promise<void> {
		if (!await this.ensureInitialized()) {
			return;
		}

		const assignment = await this.getAssignment(assignmentId);
		if (!assignment) {
			return;
		}

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
			console.log('Submitting assignment payload (studentAssignmentsService):', payload);
			await this.apiClient.post<void>(`/student/assignments/${assignmentId}/submit`, payload);
			await this.fetchAssignmentsForCourse(assignment.courseId);
			this._onDidChangeAssignments.fire(assignment.courseId);
		} catch (error) {
			console.error('Failed to submit assignment', error);
			throw error;
		}
	}

	async getSubmission(assignmentId: string): Promise<ISubmission | undefined> {
		if (!await this.ensureInitialized()) {
			return undefined;
		}

		try {
			const response = await this.apiClient.get<ISubmissionResponse>(`/student/assignments/${assignmentId}/submission`);
			return this.toSubmission(response.data);
		} catch (error) {
			console.error('Failed to fetch assignment submission', error);
			return undefined;
		}
	}

	async openAssignmentFolder(assignmentId: string): Promise<void> {
		console.log(`[OPEN ASSIGNMENT FOLDER] Attempting to open folder for assignment ${assignmentId}`);

		if (!await this.ensureInitialized()) {
			return;
		}

		const assignment = await this.getAssignment(assignmentId);
		if (!assignment) {
			return;
		}

		try {
			const folderUri = await this.downloadAssignmentFiles(assignment);

			console.log(`[OPEN ASSIGNMENT FOLDER] Folder URI for assignment ${assignmentId}: ${folderUri}`);

			if (folderUri) {
				try {
					// Prefer revealing in the OS file explorer when available
					await this.commandService.executeCommand('revealFileInOS', folderUri);
				} catch (error) {
					console.error('Failed to reveal assignment folder in OS, falling back to workbench explorer', error);
					await this.commandService.executeCommand('revealInExplorer', folderUri);
				}
			}
		} catch (error) {
			console.error('Failed to open assignment folder', error);
		}
	}

	async openCourseFolder(courseId: string): Promise<void> {
		if (!await this.ensureInitialized()) {
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
				console.error('Failed to reveal course folder in OS, falling back to workbench explorer', error);
				await this.commandService.executeCommand('revealInExplorer', courseFolder);
			}
		} catch (error) {
			console.error('Failed to open course folder', error);
		}
	}

	async refresh(): Promise<void> {
		if (!await this.ensureInitialized()) {
			return;
		}

		await this.fetchCourses();
		this.assignments.clear();
		this._onDidChangeCourses.fire();
	}

	private async fetchCourses(): Promise<void> {
		try {
			const response = await this.apiClient.get<CourseResponse[]>('/student/courses');
			this.courses = response.data.map(course => this.toCourse(course));
		} catch (error) {
			console.error('Failed to fetch courses', error);
		}
	}

	private async fetchAssignmentsForCourse(courseId: string): Promise<void> {
		try {
			const response = await this.apiClient.get<AssignmentResponse[]>(`/student/courses/${courseId}/assignments`);
			const normalized = response.data.map(assignment => this.toAssignment(assignment));
			this.assignments.set(courseId, normalized);
		} catch (error) {
			console.error('Failed to fetch assignments for course', error);
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

	private toSubmission(submission: ISubmissionResponse): ISubmission {
		return {
			assignmentId: String(submission.assignment_id),
			submitted: Boolean(submission.submitted),
			submittedAt: submission.submitted_at ? new Date(submission.submitted_at) : null,
			score: typeof submission.score === 'number' ? submission.score : null,
			feedback: submission.feedback,
			gradedAt: submission.graded_at ? new Date(submission.graded_at) : null,
			files: Array.isArray(submission.files) ? submission.files.map(file => ({
				filename: String(file.filename),
				mimeType: String(file.mime_type),
				url: String(file.url)
			})) : []
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
			console.error('Failed to add StudentAssignments root to workspace', error);
		}
	}

	private async getAssignmentFolderUri(assignment: IAssignment, course: ICourse | undefined): Promise<URI> {
		const root = await this.getAssignmentsRootFolder();
		const courseSegment = this.sanitizeName(course ? course.name : assignment.courseId);
		const assignmentSegment = this.sanitizeName(assignment.title || assignment.id);
		return joinPath(root, courseSegment, assignmentSegment);
	}

	private async downloadAssignmentFiles(assignment: IAssignment): Promise<URI | undefined> {
		const course = await this.getCourse(assignment.courseId);
		const folderUri = await this.getAssignmentFolderUri(assignment, course);
		await this.fileService.createFolder(folderUri);

		for (const file of assignment.files) {
			if (!file.downloadUrl) {
				continue;
			}

			const targetUri = joinPath(folderUri, this.sanitizeName(file.name));
			try {
				const context = await this.requestService.request({ url: file.downloadUrl, type: 'GET' }, CancellationToken.None);
				const buffer = await streamToBuffer(context.stream);
				await this.fileService.writeFile(targetUri, buffer);
			} catch (error) {
				console.error('Failed to download assignment file', file.name, error);
			}
		}

		return folderUri;
	}
}
