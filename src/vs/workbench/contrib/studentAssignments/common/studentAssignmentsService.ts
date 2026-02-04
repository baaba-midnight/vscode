/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

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
	downloadUrl?: string;
}

export interface ISubmission {
	assignmentId: string;
	submittedAt: Date;
	files: string[];
	grade?: number;
	feedback?: string;
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
	submitAssignment(assignmentId: string): Promise<void>;

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

	constructor() {
		// Initialize with mock data for now
		// In production, this would fetch from your backend API
		this.initializeMockData();
	}

	async getCourses(): Promise<ICourse[]> {
		// In production: fetch from API
		// return await this.apiClient.get('/courses');
		return this.courses;
	}

	async getCourse(courseId: string): Promise<ICourse | undefined> {
		return this.courses.find(c => c.id === courseId);
	}

	async getAssignmentsByCourse(courseId: string): Promise<IAssignment[]> {
		// In production: fetch from API
		// return await this.apiClient.get(`/courses/${courseId}/assignments`);
		return this.assignments.get(courseId) || [];
	}

	async getAssignment(assignmentId: string): Promise<IAssignment | undefined> {
		for (const assignments of this.assignments.values()) {
			const assignment = assignments.find(a => a.id === assignmentId);
			if (assignment) {
				return assignment;
			}
		}
		return undefined;
	}

	async startAssignment(assignmentId: string): Promise<void> {
		// In production:
		// 1. Download assignment files from server
		// 2. Create workspace folder
		// 3. Update assignment status
		// 4. Notify backend

		const assignment = await this.getAssignment(assignmentId);
		if (assignment) {
			assignment.status = AssignmentStatus.InProgress;
			this._onDidChangeAssignments.fire(assignment.courseId);
		}
	}

	async submitAssignment(assignmentId: string): Promise<void> {
		// In production:
		// 1. Validate required files exist
		// 2. Upload files to server
		// 3. Update assignment status
		// 4. Create submission record

		const assignment = await this.getAssignment(assignmentId);
		if (assignment) {
			assignment.status = AssignmentStatus.Submitted;
			this._onDidChangeAssignments.fire(assignment.courseId);
		}
	}

	async getSubmission(assignmentId: string): Promise<ISubmission | undefined> {
		// In production: fetch from API
		// return await this.apiClient.get(`/assignments/${assignmentId}/submission`);
		return undefined;
	}

	async openAssignmentFolder(assignmentId: string): Promise<void> {
		// In production: open the assignment folder in VS Code explorer
		// const assignment = await this.getAssignment(assignmentId);
		// const folderPath = this.getAssignmentFolderPath(assignment);
		// vscode.commands.executeCommand('revealInExplorer', folderPath);
	}

	async openCourseFolder(courseId: string): Promise<void> {
		// In production: open the course folder in VS Code explorer
	}

	async refresh(): Promise<void> {
		// In production: re-fetch from API
		// this.courses = await this.apiClient.get('/courses');
		// ... refresh assignments
		this._onDidChangeCourses.fire();
	}

	/**
	 * Initialize with mock data for development
	 */
	private initializeMockData(): void {
		this.courses = [
			{
				id: 'cs101',
				name: 'Introduction to Computer Science',
				instructor: 'Dr. Sarah Johnson',
				term: 'Fall 2025',
				description: 'Learn fundamental programming concepts using Python',
				color: '#007ACC',
				status: CourseStatus.Active,
				assignmentCount: 8,
				subject: 'Computer Science'
			},
			{
				id: 'cs201',
				name: 'Data Structures and Algorithms',
				instructor: 'Prof. Michael Chen',
				term: 'Fall 2025',
				description: 'Advanced data structures, algorithm design and analysis',
				color: '#4EC9B0',
				status: CourseStatus.Active,
				assignmentCount: 6,
				subject: 'Computer Science'
			},
			{
				id: 'cs150',
				name: 'Web Development Fundamentals',
				instructor: 'Dr. Emily Martinez',
				term: 'Spring 2025',
				description: 'HTML, CSS, JavaScript, and modern web frameworks',
				color: '#CE9178',
				status: CourseStatus.Completed,
				assignmentCount: 10,
				subject: 'Web Development'
			}
		];

		this.assignments.set('cs101', [
			{
				id: 'cs101-a1',
				courseId: 'cs101',
				title: 'Python Basics - Variables and Data Types',
				description: 'Write programs using Python variables, data types, and basic operations',
				instructions: 'Complete the exercises in the provided Python file. Implement functions for each task.',
				requirements: [
					'Create variables of different types',
					'Perform arithmetic operations',
					'Use string methods',
					'Write at least 5 test cases'
				],
				status: AssignmentStatus.InProgress,
				dueDate: '2026-02-10',
				points: 100,
				type: 'Exercise',
				files: [
					{ name: 'basics.py', size: '3.2 KB', type: 'py', required: true },
					{ name: 'test_basics.py', size: '2.1 KB', type: 'py', required: false }
				]
			},
			{
				id: 'cs101-a2',
				courseId: 'cs101',
				title: 'Control Flow and Functions',
				description: 'Master conditionals, loops, and function definitions',
				instructions: 'Implement the required functions using proper control flow structures.',
				requirements: [
					'Use if/else statements correctly',
					'Implement for and while loops',
					'Define functions with parameters',
					'Include docstrings'
				],
				status: AssignmentStatus.NotStarted,
				dueDate: '2026-02-17',
				points: 100,
				type: 'Exercise',
				files: [
					{ name: 'control_flow.py', size: '4.5 KB', type: 'py', required: true }
				]
			}
		]);

		this.assignments.set('cs201', [
			{
				id: 'cs201-a1',
				courseId: 'cs201',
				title: 'Implement Binary Search Tree',
				description: 'Build a complete BST implementation with all standard operations',
				instructions: 'Implement a binary search tree class with insert, delete, search, and traversal methods.',
				requirements: [
					'Implement BST class with node structure',
					'Add insert and delete methods',
					'Implement in-order, pre-order, post-order traversal',
					'Write comprehensive unit tests',
					'Analyze time complexity'
				],
				status: AssignmentStatus.Submitted,
				dueDate: '2026-02-05',
				points: 150,
				type: 'Project',
				files: [
					{ name: 'bst.py', size: '8.3 KB', type: 'py', required: true },
					{ name: 'test_bst.py', size: '5.2 KB', type: 'py', required: true },
					{ name: 'analysis.md', size: '2.1 KB', type: 'md', required: false }
				]
			},
			{
				id: 'cs201-a2',
				courseId: 'cs201',
				title: 'Graph Algorithms Implementation',
				description: 'Implement BFS, DFS, and Dijkstra\'s algorithm',
				instructions: 'Build a graph class and implement common graph traversal and shortest path algorithms.',
				requirements: [
					'Create graph representation',
					'Implement BFS and DFS',
					'Implement Dijkstra\'s algorithm',
					'Compare performance',
					'Provide example graphs'
				],
				status: AssignmentStatus.Overdue,
				dueDate: '2026-02-01',
				points: 200,
				type: 'Project',
				files: [
					{ name: 'graph.py', size: '10.5 KB', type: 'py', required: true },
					{ name: 'algorithms.py', size: '12.3 KB', type: 'py', required: true }
				]
			}
		]);
	}
}
