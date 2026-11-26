import {
	ErrorKinds,
	ErrorUtils,
	ReportedError,
	errorKind,
} from "../../base/errors.js";
import { Result } from "../../base/result.js";
import { exitCodeOfSignal } from "../lifecycle/lifecycle-service.js";

export function exitCodeOf(error: Error): number {
	const cause = error instanceof ReportedError ? error.cause : error;
	return ErrorKinds[errorKind(ErrorUtils.fromUnknown(cause))].exitCode;
}

export function exitCode(
	outcome: Result<void, Error>,
	signal?: NodeJS.Signals
): number {
	if (signal !== undefined) return exitCodeOfSignal(signal);
	return outcome.isErr() ? exitCodeOf(outcome.error) : 0;
}
