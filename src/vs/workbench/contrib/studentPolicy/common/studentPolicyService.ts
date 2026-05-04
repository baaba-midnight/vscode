/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { DEFAULT_ALLOWED_EXTENSIONS, STUDENT_ALLOWLIST_MODE_SETTING, STUDENT_ALLOWLIST_SETTING } from './defaults.js';
import { IStudentPolicyService, StudentAllowlistMode } from './studentPolicy.js';

interface IStudentProductConfig {
	readonly studentMode?: boolean;
	readonly student?: {
		readonly allowedExtensions?: readonly string[];
		readonly blockedExtensions?: readonly string[];
	};
}

export class StudentPolicyService extends Disposable implements IStudentPolicyService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangePolicy = this._register(new Emitter<void>());
	readonly onDidChangePolicy: Event<void> = this._onDidChangePolicy.event;

	constructor(
		@IProductService private readonly productService: IProductService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(STUDENT_ALLOWLIST_SETTING) || e.affectsConfiguration(STUDENT_ALLOWLIST_MODE_SETTING)) {
				this._onDidChangePolicy.fire();
			}
		}));
	}

	isStudentModeEnabled(): boolean {
		const product = this.productService as unknown as IStudentProductConfig;
		return product.studentMode === true;
	}

	getAllowedExtensions(): readonly string[] {
		const product = this.productService as unknown as IStudentProductConfig;

		const productDefaults = this.normalizeList(product.student?.allowedExtensions);
		const baseDefaults = productDefaults.length > 0 ? productDefaults : this.normalizeList(DEFAULT_ALLOWED_EXTENSIONS);

		const configuredAllowlist = this.normalizeList(this.configurationService.getValue<string[]>(STUDENT_ALLOWLIST_SETTING));
		const mode = this.configurationService.getValue<StudentAllowlistMode>(STUDENT_ALLOWLIST_MODE_SETTING) ?? 'extend';

		const merged = mode === 'override'
			? configuredAllowlist
			: Array.from(new Set([...baseDefaults, ...configuredAllowlist]));

		const blocked = new Set(this.normalizeList(product.student?.blockedExtensions));
		return merged.filter(id => !blocked.has(id));
	}

	isExtensionAllowed(extensionId: string): boolean {
		if (!this.isStudentModeEnabled()) {
			return true;
		}

		const normalized = extensionId.trim().toLowerCase();
		if (!normalized) {
			return false;
		}

		return new Set(this.getAllowedExtensions()).has(normalized);
	}

	private normalizeList(values: readonly string[] | undefined): string[] {
		if (!values || !Array.isArray(values)) {
			return [];
		}

		const result: string[] = [];
		for (const value of values) {
			const normalized = value.trim().toLowerCase();
			if (normalized) {
				result.push(normalized);
			}
		}

		return result;
	}
}
