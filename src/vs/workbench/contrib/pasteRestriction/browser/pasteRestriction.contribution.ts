/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CutAction, CopyAction, PasteAction } from '../../../../editor/contrib/clipboard/browser/clipboard.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IStudentPolicyService } from '../../studentPolicy/common/studentPolicy.js';

// PasteAction is a MutiCommand: multi implemnetations can register against that
// same command id, tried in priority order (highest first) until one returns `true`.
// The core "code-editor" implementation in clipboard.ts registers at prioritt 10000.
// We register above that, at 20000, so our policy check alwats gets first refusal,
// regardless of whether paste was triggered by keyboard, right-click menu, or the
// command palette, since all three funnel through this same command id.

function registerClipboardBlock(
	action: typeof CutAction,
	commandName: string,
	warningMessage: string
): void {
	if (!action) {
		return;
	}
	console.log(`[clipboadrestriction] Registering block for ${commandName}`);

	action.addImplementation(
		20000,
		`clipboard-restriction-${commandName}`,
		(accessor: ServicesAccessor, args: unknown) => {
			const policyService = accessor.get(IStudentPolicyService);
			const codeEditorService = accessor.get(ICodeEditorService);
			const notificationService = accessor.get(INotificationService);

			if (!policyService.isStudentModeEnabled()) {
				return false; // not restricted - fall through to the real implementation
			}

			const focusedEditor = codeEditorService.getFocusedCodeEditor();

			// If there's no focused editor, or focus isnt actually in the text area
			// Returning false lets the next-prority implementation (core, at 10000)
			// decide what to do instead
			if (!focusedEditor || !focusedEditor.hasTextFocus()) {
				return false;
			}


			notificationService.warn('Paste is restricted for this assignment.');
			return true;
		});
}

registerClipboardBlock(CutAction, 'cut', 'Cut is disabled in student mode.');
registerClipboardBlock(CopyAction, 'copy', 'Copy is disabled in student mode');
registerClipboardBlock(PasteAction, 'paste', 'Paste is disable in student mode.');
