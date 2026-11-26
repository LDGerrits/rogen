import {
	CancelledError,
	IoError,
	ProjectError,
	ReportedError,
	ToolError,
	UsageError,
} from "../../../base/errors.js";
import { DiagnosticsError } from "../../diagnostics/diagnostics-error.js";
import { Result, err, ok } from "../../../base/result.js";
import { exitCode, exitCodeOf } from "../exit-code.js";

describe("exitCodeOf", () => {
	it("should be 2 for a wrong command line, reported or not", () => {
		const usage = new UsageError("Unknown option '--all'.");

		expect(exitCodeOf(usage)).toBe(2);
		expect(exitCodeOf(new ReportedError(usage))).toBe(2);
	});

	it("should follow the kind of a failure", () => {
		for (const [error, code] of [
			[new UsageError("x"), 2],
			[new ProjectError("x"), 1],
			[new ToolError("x"), 1],
			[new IoError("x"), 1],
			[new CancelledError("x"), 1],
		] as const)
			expect(exitCodeOf(error)).toBe(code);
	});

	it("should be 1 for any other failure", () => {
		expect(exitCodeOf(new Error("write failed"))).toBe(1);
		expect(exitCodeOf(new CancelledError("init cancelled."))).toBe(1);
		expect(exitCodeOf(new ReportedError(new DiagnosticsError([])))).toBe(1);
	});
});

describe("exitCode", () => {
	it("should be 0 for a run that finished", () => {
		expect(exitCode(ok(undefined))).toBe(0);
	});

	it("should be the code of the failure for a run that failed", () => {
		const failed = (error: Error): Result<void, Error> => err(error);

		expect(exitCode(failed(new UsageError("x")))).toBe(2);
		expect(exitCode(failed(new ProjectError("x")))).toBe(1);
		expect(exitCode(failed(new Error("x")))).toBe(1);
	});

	it.each([
		["finished without a signal", ok(undefined), undefined, 0],
		["failed without a signal", err(new UsageError("x")), undefined, 2],
		["finished after SIGINT", ok(undefined), "SIGINT", 130],
		["failed after SIGINT", err(new UsageError("x")), "SIGINT", 130],
		[
			"failed in full after SIGTERM",
			err(new ReportedError(new Error("x"))),
			"SIGTERM",
			143,
		],
		["finished after SIGHUP", ok(undefined), "SIGHUP", 129],
		[
			"finished after a signal the system lacks",
			ok(undefined),
			"SIGLOST",
			128,
		],
	] as const)(
		"should be, for a run that %s, the code of the signal, else of the outcome",
		(_, outcome: Result<void, Error>, signal, code) => {
			expect(exitCode(outcome, signal)).toBe(code);
		}
	);
});
