/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface CourseResponse {
	id: String;
	name: String;
	code: String;
	description: String; // optional
	instructor_name: String;
	term: String;
	status: String;
	assignment_count: number;
	submitted_count: number;
}

export interface AssignmentFile {
	id: String;
	filename: String;
	file_type: String;
	is_required: Boolean;
	storage_path: String;
	download_url: String; // optional
}


export interface AssignmentResponse {
	id: String;
	course_id: String;
	title: String;
	description: String;
	instructions: String;
	points: number;
	due_date: String;
	status: String;
	started_at: String; // optional
	submitted_at: String; //optional
	is_overdue: Boolean;
	course_name: String;
	course_code: String;
	files: AssignmentFile[];
}
