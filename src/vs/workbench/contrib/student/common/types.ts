/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
	tasks_completed: number;
	time_spent: number;
	confidence: number | null;
	current_difficulty: string | null;
}

export interface AdaptResponse {
	adaptive_prompt?: string;
	ai_response?: string;
	student_state?: StudentState;
	tracker_metrics?: TrackerMetrics;
}

export interface AdaptRequest {
	student_id: string;
	student_query: string;
	reflection?: string | null;
	task_result?: string | null;
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
