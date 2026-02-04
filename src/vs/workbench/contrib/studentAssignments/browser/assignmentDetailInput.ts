/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IAssignment } from '../common/studentAssignmentsService.js';

export class AssignmentDetailInput extends EditorInput {
	override get resource(): URI | undefined {
		throw new Error('Method not implemented.');
	}
	static readonly ID: string = 'workbench.input.assignmentDetail';

	readonly assignment: IAssignment;

	constructor(assignment: IAssignment) {
		super();
		this.assignment = assignment;
	}

	override get typeId(): string {
		return AssignmentDetailInput.ID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly;
	}

	override getName(): string {
		return this.assignment.title;
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(otherInput)) {
			return true;
		}

		if (otherInput instanceof AssignmentDetailInput) {
			return otherInput.assignment.id === this.assignment.id;
		}

		return false;
	}
}
