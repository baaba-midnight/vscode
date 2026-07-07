/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { PendingAttachmentInput } from '../common/types.js';
import { StudentChatPanel } from './studentChatPanel.js';

async function revealChatPanel(accessor: ServicesAccessor): Promise<StudentChatPanel | undefined> {
	const viewsService = accessor.get(IViewsService);
	const view = await viewsService.openView<StudentChatPanel>('workbench.view.student.chat', true);
	return view ?? undefined;
}

class SendSelectionToChatAction extends Action2 {
	constructor() {
		console.log('[studentChat.Attachment] Registering sendSelection action ...');
		super({
			id: 'student.sendSelectionToChat',
			title: localize2('sendSelectionToChat', "Send Selection to Chat"),
			category: Categories.View,
			f1: true,
			precondition: EditorContextKeys.hasNonEmptySelection,
			menu: {
				id: MenuId.EditorContext,
				group: '9_cutcopypaste',
				when: EditorContextKeys.hasNonEmptySelection,
				order: 1
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const codeEditorService = accessor.get(ICodeEditorService);
		const editor = codeEditorService.getFocusedCodeEditor();
		if (!editor || !editor.hasModel()) {
			return;
		}

		const selection = editor.getSelection();
		if (!selection || selection.isEmpty()) {
			return;
		}

		const model = editor.getModel();
		const content = model.getValueInRange(selection);
		const fileName = model.uri.path.split('/').pop() ?? model.uri.path;

		const attachment: PendingAttachmentInput = {
			kind: 'selection',
			fileName,
			range: {
				startLine: selection.startLineNumber,
				endLine: selection.endLineNumber,
			},
			content
		};

		const panel = await revealChatPanel(accessor);
		panel?.addAttachment(attachment);
	}
}

class SendFileToChatAction extends Action2 {
	constructor() {
		console.log('[studentChat.Attachment] Registering sendFile action ...');
		super({
			id: 'student.sendFileToChat',
			title: localize2('sendFileToChat', "Send File to Chat"),
			category: Categories.View,
			f1: true,
			menu: {
				id: MenuId.EditorContext,
				group: '9_cutcopypaste',
				order: 2
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const codeEditorService = accessor.get(ICodeEditorService);
		const editor = codeEditorService.getFocusedCodeEditor();
		if (!editor || !editor.hasModel()) {
			return;
		}

		const model = editor.getModel();
		const content = model.getValue();
		const fileName = model.uri.path.split('/').pop() ?? model.uri.path;

		const attachment: PendingAttachmentInput = {
			kind: 'file',
			fileName,
			content
		};

		const panel = await revealChatPanel(accessor);
		panel?.addAttachment(attachment);
	}
}

registerAction2(SendSelectionToChatAction);
registerAction2(SendFileToChatAction);
