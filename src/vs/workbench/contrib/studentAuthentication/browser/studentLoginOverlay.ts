/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/studentLoginView.css';

import * as nls from '../../../../nls.js';
import { DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import * as DOM from '../../../../base/browser/dom.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { defaultInputBoxStyles } from '../../../../platform/theme/browser/defaultStyles.js';

/**
 * Render the student login UI as a centered modal overlay on top of the workbench.
 */
export function showStudentLoginOverlay(
	commandService: ICommandService,
	contextViewService: IContextViewService
): void {
	const disposables = new DisposableStore();

	const overlay = document.createElement('div');
	overlay.classList.add('student-login-overlay');
	const targetWindow = DOM.getActiveWindow();
	targetWindow.document.body.appendChild(overlay);

	const modal = document.createElement('div');
	modal.classList.add('student-login-modal');
	overlay.appendChild(modal);

	// Close helpers
	const close = (): void => {
		disposables.dispose();
		overlay.remove();
	};

	const onKeyDown = (event: KeyboardEvent): void => {
		if (event.key === 'Escape') {
			close();
		}
	};
	targetWindow.addEventListener('keydown', onKeyDown);
	disposables.add(toDisposable(() => targetWindow.removeEventListener('keydown', onKeyDown)));

	// Close button (top-right)
	const closeButton = document.createElement('button');
	closeButton.classList.add('student-login-close-button');
	closeButton.title = nls.localize('studentLogin.close', "Close");
	closeButton.textContent = '×';
	modal.appendChild(closeButton);

	closeButton.addEventListener('click', () => close());

	overlay.addEventListener('click', event => {
		if (event.target === overlay) {
			close();
		}
	});

	// Title & subtitle
	const title = document.createElement('h2');
	title.classList.add('student-login-title');
	title.textContent = nls.localize('studentLogin.loginTitle', "Welcome to the Student Portal");
	modal.appendChild(title);

	const subtitle = document.createElement('p');
	subtitle.classList.add('student-login-subtitle');
	subtitle.textContent = nls.localize('studentLogin.loginSubtitle', "Sign in with your student account to access assignments and chat");
	modal.appendChild(subtitle);

	// Form container
	const form = document.createElement('div');
	form.classList.add('student-login-form');
	modal.appendChild(form);

	// Email input
	const emailLabel = document.createElement('label');
	emailLabel.classList.add('student-login-label');
	emailLabel.textContent = nls.localize('studentLogin.email', "Email");
	form.appendChild(emailLabel);

	const emailInputContainer = document.createElement('div');
	emailInputContainer.classList.add('student-login-input-container');
	form.appendChild(emailInputContainer);

	const emailInput = new InputBox(emailInputContainer, contextViewService, {
		inputBoxStyles: defaultInputBoxStyles,
		placeholder: nls.localize('studentLogin.email.Placeholder', "student@example.com.edu")
	});
	disposables.add(emailInput);

	// Password input
	const passwordLabel = document.createElement('label');
	passwordLabel.classList.add('student-login-label');
	passwordLabel.textContent = nls.localize('studentLogin.password', "Password");
	form.appendChild(passwordLabel);

	const passwordInputContainer = document.createElement('div');
	passwordInputContainer.classList.add('student-login-input-container');
	form.appendChild(passwordInputContainer);

	const passwordInput = new InputBox(passwordInputContainer, contextViewService, {
		inputBoxStyles: defaultInputBoxStyles,
		placeholder: nls.localize('studentLogin.password.Placeholder', "Enter your password")
	});
	passwordInput.inputElement.type = 'password';
	disposables.add(passwordInput);

	// Error label
	const errorLabel = document.createElement('div');
	errorLabel.classList.add('student-login-error');
	form.appendChild(errorLabel);

	// Sign-in button
	const buttonContainer = document.createElement('div');
	buttonContainer.classList.add('student-login-button-container');
	form.appendChild(buttonContainer);

	const signInLabel = nls.localize('studentLogin.signIn', "Sign In");
	const signInButton = document.createElement('button');
	signInButton.type = 'button';
	signInButton.classList.add('student-login-button');
	signInButton.textContent = signInLabel;
	buttonContainer.appendChild(signInButton);

	let isSigningIn = false;

	const runSignIn = async () => {
		if (isSigningIn) {
			return;
		}

		const email = emailInput.value.trim();
		const password = passwordInput.value.trim();

		errorLabel.textContent = '';

		if (!email || !password) {
			errorLabel.textContent = nls.localize('studentLogin.error.required', "Email and password are required.");
			return;
		}

		isSigningIn = true;
		signInButton.disabled = true;
		signInButton.textContent = nls.localize('studentLogin.signingIn', 'Signing In...');
		emailInput.inputElement.readOnly = true;
		passwordInput.inputElement.readOnly = true;

		try {
			await commandService.executeCommand('studentLogin.performLogin', { email, password });
			// Clear fields and close on successful login once auth + preload complete
			emailInput.value = '';
			passwordInput.value = '';
			close();
		} catch (err) {
			errorLabel.textContent = nls.localize('studentLogin.error.generic', "Sign-in failed. Please check your credentials and try again.");
		} finally {
			isSigningIn = false;
			signInButton.disabled = false;
			signInButton.textContent = signInLabel;
			emailInput.inputElement.readOnly = false;
			passwordInput.inputElement.readOnly = false;
		}
	};

	signInButton.addEventListener('click', () => runSignIn());

	disposables.add(toDisposable(() => signInButton.removeEventListener('click', () => runSignIn())));
}
