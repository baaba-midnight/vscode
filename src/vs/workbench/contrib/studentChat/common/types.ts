/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ApiResponse<T> {
	data: T;
	message?: string;
	error?: string;
}

export interface AssignmentFile {
	id: string;
	// New backend shape
	filename?: string;
	url?: string;
	// Legacy/optional fields kept for compatibility
	assignment_id?: string;
	file_name?: string;
	file_path?: string;
	mime_type?: string;
	uploaded_at?: string;
}

export interface Assignment {
	assignment_id: string;
	title: string;
	description: string;
	due_date: string;
	// created_by?: string;
	// created_at?: string;
	// total_points?: number;
	// ai_help_policy?: string;
	// updated_at?: string;
	// files?: AssignmentFile[];
}

export interface AssignmentDetails extends Assignment {
	created_by?: string;
	created_at?: string;
	total_points?: number;
	ai_help_policy?: string;
	updated_at?: string;
	files?: AssignmentFile[];
}

export interface StudentState {
	accuracy?: number; // float
	struggles?: number; // integer
	current_difficulty?: string;
	support_level?: string;
}

export interface TrackerMetrics {
	accuracy: number;
	hint_count: number;
	struggles: number;
	time_spent: number;
	confidence?: string | null;
	current_difficulty?: number | null;
}

export interface AdaptResponse {
	adaptive_prompt: string;
	ai_response: string;
	student_state?: StudentState;
	tracker_metrics?: TrackerMetrics;
}

export interface AdaptRequest {
	student_id: string;
	student_query: string;
	reflection?: string | null;
	task_result?: string | null;
	assignment_id?: string | null;
}

export interface ChatMessageCreate {
	assignment_id?: string | null;
	user_id: string;
	sender_type: string; // 'student' | 'instructor' | 'system'
	message_text: string;
}

export interface ChatMessage {
	chat_id: string;
	assignment_id?: string | null;
	user_id: string;
	sender_type: string; // 'student' | 'instructor' | 'system'
	message_text: string;
	created_at: string; // ISO timestamp
}
