import { safeStringify } from "./json.js";

/**
 * Node's `EACCES: permission denied, open '/x'` becomes `permission denied`.
 */
export function failureReason(error: Error): string {
	const code = /^[A-Z][A-Z0-9]+: /;
	if (!code.test(error.message)) return error.message;
	return error.message.replace(code, "").replace(/, [a-z]+( '.*')?$/, "");
}

// Jest runs each test file in a vm context of its own, where an error thrown
// by one of Node's modules fails `instanceof Error`.
function isErrorFromAnotherRealm(value: unknown): value is Error {
	return (
		typeof value === "object" &&
		value !== null &&
		Object.prototype.toString.call(value) === "[object Error]"
	);
}

export const ErrorUtils = {
	fromUnknown(error: unknown): Error {
		if (error instanceof Error || isErrorFromAnotherRealm(error)) {
			return error;
		}
		if (typeof error === "string") {
			return new Error(error);
		}
		return new Error(
			`An unexpected error occurred: ${safeStringify(error)}`
		);
	},

	hasCode(error: unknown, ...codes: string[]): boolean {
		return (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			typeof error.code === "string" &&
			codes.includes(error.code)
		);
	},

	isSystemError(error: unknown): error is Error & { readonly code: string } {
		return (
			error instanceof Error &&
			"code" in error &&
			typeof error.code === "string" &&
			/^E[A-Z0-9]+$/.test(error.code)
		);
	},

	wrap(what: string, cause: Error): IoError {
		return new IoError(`${what}: ${failureReason(cause)}`, undefined, {
			cause,
		});
	},
};

export const ExitCodes = {
	0: "done (warnings included)",
	1: "the project has a problem: an error, or Rojo failing",
	2: "the command line is wrong, or a terminal is needed and there is none",
} as const;

export const DefaultCommandExitCodes = {
	0: "done (warnings included)",
	1: "an error stopped it",
	2: "the command line is wrong",
} as const;

export const ErrorKinds = {
	usage: { exitCode: 2, meaning: "the command line is wrong" },
	project: {
		exitCode: 1,
		meaning: "the project is not in a state the command can run on",
	},
	tool: {
		exitCode: 1,
		meaning: "a program Rogen needs is missing or failed",
	},
	io: {
		exitCode: 1,
		meaning: "a file or directory could not be read or written",
	},
	cancelled: { exitCode: 1, meaning: "the run was cancelled" },
	internal: { exitCode: 1, meaning: "a bug in Rogen" },
} as const;

export type ErrorKind = keyof typeof ErrorKinds;

export abstract class KindedError extends Error {
	abstract readonly kind: ErrorKind;

	constructor(
		readonly reason: string,
		readonly hint?: string,
		options?: ErrorOptions
	) {
		super(hint ? `${reason} ${hint}` : reason, options);
	}
}

export class CancelledError extends KindedError {
	override readonly name = "CancelledError";
	readonly kind = "cancelled";
}

export class UsageError extends KindedError {
	override readonly name = "UsageError";
	readonly kind = "usage";
}

export class ProjectError extends KindedError {
	override readonly name = "ProjectError";
	readonly kind = "project";
}

export class ToolError extends KindedError {
	override readonly name = "ToolError";
	readonly kind = "tool";
}

export class IoError extends KindedError {
	override readonly name = "IoError";
	readonly kind = "io";
}

export class ReportedError extends Error {
	override readonly name = "ReportedError";

	constructor(cause: Error) {
		super(cause.message, { cause });
	}
}

export function errorKind(error: Error): ErrorKind {
	if (error instanceof KindedError) return error.kind;
	return ErrorUtils.isSystemError(error) ? "io" : "internal";
}

type UnexpectedErrorHandler = (error: Error) => void;

const defaultUnexpectedErrorHandler: UnexpectedErrorHandler = (error) => {
	setTimeout(() => {
		throw error;
	}, 0);
};

let unexpectedErrorHandler: UnexpectedErrorHandler =
	defaultUnexpectedErrorHandler;

export function setUnexpectedErrorHandler(
	newHandler: UnexpectedErrorHandler
): UnexpectedErrorHandler {
	const previousHandler = unexpectedErrorHandler;
	unexpectedErrorHandler = newHandler;
	return previousHandler;
}

export function onUnexpectedError(error: unknown): void {
	try {
		unexpectedErrorHandler(ErrorUtils.fromUnknown(error));
	} catch (handlerError) {
		defaultUnexpectedErrorHandler(ErrorUtils.fromUnknown(handlerError));
	}
}
