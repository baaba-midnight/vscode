/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { ICourse } from '../common/studentAssignmentsService.js';
import { URI } from '../../../../base/common/uri.js';

export class CourseDetailInput extends EditorInput {
	static readonly ID: string = 'workbench.input.courseDetail';

	readonly course: ICourse;

	constructor(course: ICourse) {
		super();
		this.course = course;
	}

	override get typeId(): string {
		return CourseDetailInput.ID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly;
	}

	override get resource(): URI | undefined {
		// This editor is logical (not file-backed), so it has no concrete resource.
		return undefined;
	}

	override getName(): string {
		return this.course.name;
	}

	override getDescription(): string {
		return this.course.instructor
			? localize('courseDetailDescription', "{0} • {1}", this.course.instructor, this.course.term)
			: this.course.term;
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(otherInput)) {
			return true;
		}

		if (otherInput instanceof CourseDetailInput) {
			return otherInput.course.id === this.course.id;
		}

		return false;
	}
}
