/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../browser/editorBrowser.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../../editor/browser/editorExtensions.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { IKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';

export class DisableCopyPasteController extends Disposable implements IEditorContribution {
	public static readonly ID = 'editor.contrib.disableCopyPasteController';

	constructor(private readonly editor: ICodeEditor) {
		super();
		this._register(this.editor.onKeyDown(e => this.onKeyDown(e)));
	}

	private onKeyDown(e: IKeyboardEvent): void {
		// Block Ctrl/Cmd+C, Ctrl/Cmd+V, Ctrl/Cmd+X
		const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
		const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;
		const keyCode = e.keyCode;

		console.log(`[DisableCopyPasteController] Key down: ctrlOrCmd=${ctrlOrCmd}, keyCode=${keyCode.toString()}`);

		// KeyCodes: C = 46, V = 49, X = 45
		if (ctrlOrCmd && (keyCode === KeyCode.KeyC || keyCode === KeyCode.KeyV || keyCode === KeyCode.KeyX)) {
			e.preventDefault();
			e.stopPropagation();
			this.editor.focus();
		}
	}
}

registerEditorContribution(DisableCopyPasteController.ID, DisableCopyPasteController, EditorContributionInstantiation.Eager);
