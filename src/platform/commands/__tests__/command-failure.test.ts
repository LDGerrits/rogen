import {
	CancelledError,
	ReportedError,
	UsageError,
} from "../../../base/errors.js";
import { errorDiagnostic } from "../../diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../diagnostics/diagnostics-error.js";
import { MockLogService } from "../../log/__tests__/mock-log-service.js";
import { CommandFailure, exitCodeOf } from "../command-failure.js";

describe("CommandFailure", () => {
	let logService: MockLogService;
	const problem = errorDiagnostic("x.err", { resource: "/a" }, "bad.");

	beforeEach(() => {
		logService = new MockLogService();
	});

	const printed = () =>
		logService.entries
			.filter(({ kind }) => kind === "print")
			.map(({ text }) => JSON.parse(text));

	describe("report", () => {
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

			expect(printed()).toEqual([{ error: "no config" }]);
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

			expect(printed()).toEqual([{ error: "x is undefined" }]);
		});

		it("should print a JSON document for a thrown value that isn't an error", () => {
			new CommandFailure(logService, true).reportCrash("boom");

			expect(printed()).toEqual([{ error: "boom" }]);
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

	it("should be 1 for any other failure", () => {
		expect(exitCodeOf(new Error("write failed"))).toBe(1);
		expect(exitCodeOf(new CancelledError("init cancelled."))).toBe(1);
		expect(exitCodeOf(new ReportedError(new DiagnosticsError([])))).toBe(1);
	});
});
