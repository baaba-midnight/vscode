/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ThemeIcon } from '../../../../base/common/themables.js';
import { append, $, addDisposableListener, clearNode } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { PendingAttachment, PendingAttachmentInput } from '../common/types.js';

/**
 * Owns the "staged attachments" state and chip UI for the student chat input.
 * The panel hands this class a container element once, and never touches
 * attachment internals directly again, it just calls add()/consumeAsMessageText().
 *
 * Pulled out of StudentChatPanel on purpose: attachment logic has nothing to do
 * with rendering message history or the assignment header, so it shouldn't share
 * a file (or a mental model) with either of those.
 */

export class StudentChatAttachments extends Disposable {

	// attachments the student has staged but not yet sent. Cleared after every send.
	private _attachments: PendingAttachment[] = [];

	private readonly _renderDisposables = this._register(new DisposableStore());

	constructor(private readonly _container: HTMLElement) {
		super();
	}

	get hasAttachments(): boolean {
		return this._attachments.length > 0;
	}

	/**
	 * Stages a new attachment and re-renders the chip row. The id is generated
	 * here rather than by the caller, since callers (the editor commands) have
	 * no reason to care about attachment identity - only this class needs it
	 * to let individual chips be removed
	 */
	add(input: PendingAttachmentInput): void {
		const attachments: PendingAttachment = { id: generateUuid(), ...input };
		this._attachments.push(attachments);
		this._render();
	}


	private _remove(id: string): void {
		this._attachments = this._attachments.filter(a => a.id !== id);
		this._render();
	}
	/**
	 * Called once, at send time. Builds the fenced-code-block text for every
	 * staged attachment and clears them - attachments are consumed by a send,
	 * not left sitting around for the next messafe
	 */
	consumeAsMessageText(): string {
		const blocks = this._attachments.map(a => {
			const label = a.kind === 'file'
				? a.fileName
				: `${a.fileName}:${a.range?.startLine} - ${a.range?.endLine}`;
			return `\`${label}\`\n\`\`\`\n${a.content}\n\`\`\``;
		}).join('\n\n');

		this._attachments = [];
		this._render();
		return blocks;
	}

	private _render(): void {
		this._renderDisposables.clear();
		clearNode(this._container);

		for (const attachment of this._attachments) {
			const chip = append(this._container, $('.chat-attachment-chip'));

			const iconCodicon = attachment.kind === 'file' ? Codicon.file : Codicon.code;
			append(chip, $('span.chat-attachment-icon' + ThemeIcon.asCSSSelector(iconCodicon)));

			const label = append(chip, $('span.chat-attachment-label'));
			label.textContent = attachment.kind === 'file'
				? attachment.fileName
				: `${attachment.fileName}:${attachment.range?.startLine}-${attachment.range?.endLine}`;
			label.title = attachment.content;

			const removeBtn = append(chip, $('button.chat-attachment-remove', {
				'aria-label': `Remove attachment ${label.textContent}`
			})) as HTMLButtonElement;
			append(removeBtn, $('span' + ThemeIcon.asCSSSelector(Codicon.close)));

			this._renderDisposables.add(addDisposableListener(removeBtn, 'click', () => {
				this._remove(attachment.id);
			}));
		}
	}
}
