import {
	CancelledError,
	IoError,
	ProjectError,
	ToolError,
	UsageError,
} from "../../../base/errors.js";
import { errorDiagnostic } from "../../diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../diagnostics/diagnostics-error.js";
import { MockLogService } from "../../log/__tests__/mock-log-service.js";
import { Result, err, ok } from "../../../base/result.js";
import { CommandFailure, exitCode, exitCodeOf } from "../command-failure.js";
import { ExitCodeError, ReportedError } from "../commands.js";

describe("CommandFailure", () => {
	let logService: MockLogService;
	const problem = errorDiagnostic("x.err", { resource: "/a" }, "bad.");

	beforeEach(() => {
		logService = new MockLogService();
	});

	const printed = () =>
		logService.texts("print").map((text) => JSON.parse(text));

	describe("report", () => {
		it("should print the message of each failure", () => {
			const failure = new CommandFailure(logService, false);

			failure.report(new UsageError("bad flag"));
			failure.report(new Error("no config"), "build");
			expect(logService.texts("error")).toEqual([
				"bad flag",
				"no config",
			]);
		});
	});

	describe("report, as told to the user", () => {
		it("should print nothing for a failure already reported in full", () => {
			new CommandFailure(logService, false).report(
				new ReportedError(new DiagnosticsError([problem])),
				"build"
			);
			new CommandFailure(logService, true).report(
				new ReportedError(new Error("x")),
				"build"
			);

			expect(logService.entries).toEqual([]);
		});

		it("should print each diagnostic of a failure, then close the frame", () => {
			logService.intro("rogen build");

			new CommandFailure(logService, false).report(
				new DiagnosticsError([problem]),
				"build"
			);

			expect(logService.lines.slice(1)).toEqual([
				"diagnosticError: /a - error: bad. (x.err)",
				"outro: build failed.",
			]);
		});

		it("should print another failure as an error, then close the frame", () => {
			logService.intro("rogen build");

			new CommandFailure(logService, false).report(
				new Error("no config"),
				"build"
			);

			expect(logService.lines.slice(1)).toEqual([
				"error: no config",
				"outro: build failed.",
			]);
		});

		it("should close the frame with the message of a cancelled run", () => {
			logService.intro("rogen init");

			new CommandFailure(logService, false).report(
				new CancelledError("init cancelled."),
				"init"
			);

			expect(logService.lines.slice(1)).toEqual([
				"outro: init cancelled.",
			]);
		});

		it("should print the diagnostics of a failure as a JSON document", () => {
			new CommandFailure(logService, true).report(
				new DiagnosticsError([problem]),
				"build"
			);

			expect(printed()).toMatchObject([
				{ diagnostics: [{ code: "x.err" }] },
			]);
			expect(logService.entries).toHaveLength(1);
		});

		it("should print the message of another failure as a JSON document", () => {
			new CommandFailure(logService, true).report(
				new Error("no config"),
				"build"
			);

			expect(printed()).toEqual([
				{
					error: {
						kind: "internal",
						message:
							"no config. This is a bug in Rogen: report it at https://github.com/LDGerrits/rogen/issues.",
					},
				},
			]);
		});

		it("should print the failure inside an exit code as the document it is", () => {
			new CommandFailure(logService, true).report(
				new ExitCodeError(3, new DiagnosticsError([problem])),
				"serve"
			);

			expect(printed()).toMatchObject([
				{ diagnostics: [{ code: "x.err" }] },
			]);
		});

		it("should print only the error for a failure before any command ran", () => {
			logService.intro("rogen");

			new CommandFailure(logService, false).report(
				new Error("unknown option")
			);

			expect(logService.lines.slice(1)).toEqual([
				"error: unknown option",
			]);
		});
	});

	describe("reportCrash", () => {
		it("should print the message of a crash as a JSON document", () => {
			new CommandFailure(logService, true).reportCrash(
				new TypeError("x is undefined")
			);

			expect(printed()).toEqual([
				{
					error: {
						kind: "internal",
						message:
							"x is undefined. This is a bug in Rogen: report it at https://github.com/LDGerrits/rogen/issues.",
					},
				},
			]);
		});

		it("should print a JSON document for a thrown value that isn't an error", () => {
			new CommandFailure(logService, true).reportCrash("boom");

			expect(printed()).toEqual([
				{
					error: {
						kind: "internal",
						message:
							"boom. This is a bug in Rogen: report it at https://github.com/LDGerrits/rogen/issues.",
					},
				},
			]);
		});

		it("should print nothing without --json", () => {
			new CommandFailure(logService, false).reportCrash(new Error("x"));

			expect(logService.entries).toEqual([]);
		});
	});
});

describe("exitCodeOf", () => {
	it("should be 2 for a wrong command line, reported or not", () => {
		const usage = new UsageError("Unknown option '--all'.");

		expect(exitCodeOf(usage)).toBe(2);
		expect(exitCodeOf(new ReportedError(usage))).toBe(2);
	});

	it("should be the code a failure carries, reported or not", () => {
		const stopped = new ExitCodeError(3, new Error("rojo stopped."));

		expect(exitCodeOf(stopped)).toBe(3);
		expect(exitCodeOf(new ReportedError(stopped))).toBe(3);
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

	it("should be 2 for a run that named no command", () => {
		expect(exitCode(ok(undefined), { bare: true })).toBe(2);
	});

	it("should be the code of the failure for a run that failed", () => {
		const failed = (error: Error): Result<void, Error> => err(error);

		expect(exitCode(failed(new UsageError("x")))).toBe(2);
		expect(exitCode(failed(new ProjectError("x")))).toBe(1);
		expect(exitCode(failed(new Error("x")))).toBe(1);
		expect(
			exitCode(failed(new ExitCodeError(130, new Error("Stopped."))))
		).toBe(130);
	});
});
