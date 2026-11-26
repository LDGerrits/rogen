import { jest } from "@jest/globals";
import {
	CancelledError,
	ReportedError,
	UsageError,
} from "../../../base/errors.js";
import {
	DiagnosticSeverity,
	errorDiagnostic,
} from "../../diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../diagnostics/diagnostics-error.js";
import { LogKind, streamOf } from "../abstract-log-service.js";
import { PlainLogService } from "../plain-log-service.js";
import { MockLogService } from "./mock-log-service.js";

describe("streamOf", () => {
	const kinds: readonly LogKind[] = [
		"result",
		"note",
		"notice",
		"annotation",
		"intro",
		"step",
		"success",
		"outro",
		"info",
		"warn",
		"error",
		"debug",
		"trace",
		"diagnosticWarning",
		"diagnosticError",
	];
	const streams = (ownLines: "stdout" | "stderr", framed: boolean) =>
		Object.fromEntries(
			kinds.map((kind) => [kind, streamOf(kind, ownLines, framed)])
		);

	it("should keep results and notes on stdout, and notices and annotations on stderr, whatever else holds", () => {
		for (const ownLines of ["stdout", "stderr"] as const)
			for (const framed of [false, true])
				expect(streams(ownLines, framed)).toMatchObject({
					result: "stdout",
					note: "stdout",
					notice: "stderr",
					annotation: "stderr",
				});
	});

	it("should send the run's own lines where they go, and problems and detail to stderr, outside a frame", () => {
		expect(streams("stdout", false)).toMatchObject({
			intro: "stdout",
			step: "stdout",
			success: "stdout",
			outro: "stdout",
			info: "stdout",
			warn: "stderr",
			error: "stderr",
			debug: "stderr",
			trace: "stderr",
			diagnosticWarning: "stderr",
			diagnosticError: "stderr",
		});
		expect(streams("stderr", false)).toMatchObject({
			intro: "stderr",
			info: "stderr",
			warn: "stderr",
		});
	});

	it("should draw everything inside a frame on the frame's stream", () => {
		expect(streams("stdout", true)).toMatchObject({
			warn: "stdout",
			error: "stdout",
			debug: "stdout",
			diagnosticError: "stdout",
		});
	});
});

describe("AbstractLogService failure", () => {
	let logService: MockLogService;
	const problem = errorDiagnostic("x.err", { resource: "/a" }, "bad.");

	beforeEach(() => {
		logService = new MockLogService();
	});

	it("should print the message of each failure", () => {
		logService.failure(new UsageError("bad flag"));
		logService.failure(new Error("no config"), "build");

		expect(logService.texts("error")).toEqual(["bad flag", "no config"]);
	});

	it("should print nothing for a failure already reported in full", () => {
		logService.failure(
			new ReportedError(new DiagnosticsError([problem])),
			"build"
		);

		expect(logService.entries).toEqual([]);
	});

	it("should print each diagnostic of a failure, then close the frame", () => {
		logService.intro("rogen build");

		logService.failure(new DiagnosticsError([problem]), "build");

		expect(logService.lines.slice(1)).toEqual([
			"diagnosticError: /a - error: bad. (x.err)",
			"outro: build failed.",
		]);
	});

	it("should annotate the diagnostics of a failure once", () => {
		const annotated = new MockLogService({ annotationsIn: "/" });

		annotated.failure(new DiagnosticsError([problem]), "build");

		expect(annotated.texts("annotation")).toEqual([
			"::error file=a,title=x.err::bad.",
		]);
	});

	it("should print another failure as an error, then close the frame", () => {
		logService.intro("rogen build");

		logService.failure(new Error("no config"), "build");

		expect(logService.lines.slice(1)).toEqual([
			"error: no config",
			"outro: build failed.",
		]);
	});

	it("should close the frame with the message of a cancelled run", () => {
		logService.intro("rogen init");

		logService.failure(new CancelledError("init cancelled."), "init");

		expect(logService.lines.slice(1)).toEqual(["outro: init cancelled."]);
	});

	it("should print only the error for a failure before any command ran", () => {
		logService.intro("rogen");

		logService.failure(new Error("unknown option"));

		expect(logService.lines.slice(1)).toEqual(["error: unknown option"]);
	});

	it("should leave a crash to the composition root, which rethrows it", () => {
		logService.crash(new Error("x"));

		expect(logService.entries).toEqual([]);
	});
});

describe("AbstractLogService formatting", () => {
	it("should include an error's cause chain, not just its own message", () => {
		const consoleSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const logService = new PlainLogService();
		const rootCause = new Error("Poison Pill");
		const wrapper = new Error("Error in event listener", {
			cause: rootCause,
		});

		logService.error(wrapper);

		expect(consoleSpy).toHaveBeenCalledTimes(1);
		const [loggedMessage] = consoleSpy.mock.calls[0] as [string];

		expect(loggedMessage).toContain("Error in event listener");
		expect(loggedMessage).toContain("Poison Pill");

		consoleSpy.mockRestore();
	});

	it("should walk multiple levels of nested causes", () => {
		const consoleSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const logService = new PlainLogService();
		const rootCause = new Error("root failure");
		const middle = new Error("middle wrapper", { cause: rootCause });
		const outer = new Error("outer wrapper", { cause: middle });

		logService.error(outer);

		const [loggedMessage] = consoleSpy.mock.calls[0] as [string];

		expect(loggedMessage).toContain("outer wrapper");
		expect(loggedMessage).toContain("middle wrapper");
		expect(loggedMessage).toContain("root failure");

		consoleSpy.mockRestore();
	});

	it("should format a non-Error cause via ErrorUtils.fromUnknown", () => {
		const consoleSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const logService = new PlainLogService();
		const wrapper = new Error("wrapper", { cause: "raw string cause" });

		logService.error(wrapper);

		const [loggedMessage] = consoleSpy.mock.calls[0] as [string];
		expect(loggedMessage).toContain("raw string cause");

		consoleSpy.mockRestore();
	});

	it("should stop at a circular cause instead of hanging", () => {
		const consoleSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const logService = new PlainLogService();
		const a = new Error("a");
		const b = new Error("b", { cause: a });
		a.cause = b;

		expect(() => logService.error(a)).not.toThrow();

		const [loggedMessage] = consoleSpy.mock.calls[0] as [string];
		expect(loggedMessage).toContain("[circular]");

		consoleSpy.mockRestore();
	});

	it("should not append anything for an error with no cause", () => {
		const consoleSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const logService = new PlainLogService();
		logService.error(new Error("standalone"));

		const [loggedMessage] = consoleSpy.mock.calls[0] as [string];
		expect(loggedMessage).not.toContain("Caused by");

		consoleSpy.mockRestore();
	});

	it("should print a diagnostic about a file whose name holds control characters as escapes", () => {
		const consoleSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});

		new PlainLogService({ cwd: "/repo" }).diagnostics([
			{
				resource: "/repo/src/a\u001b]0;x\u0007\n::error::pwned.luau",
				severity: DiagnosticSeverity.Warning,
				code: "scan.portableName",
				message: "its name is odd.",
			},
		]);

		const [line] = consoleSpy.mock.calls[0] as [string];
		expect(line).not.toContain("\u001b");
		expect(line.split("\n").some((each) => each.startsWith("::"))).toBe(
			false
		);
		consoleSpy.mockRestore();
	});

	it("should append each argument after the message, as JSON for objects", () => {
		const consoleSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		const cause = new Error("inner");
		cause.stack = "";

		new PlainLogService().error("failed", { a: 1 }, 7, circular, cause);

		expect(consoleSpy.mock.calls[0][0]).toBe(
			'error: failed {"a":1} 7 [Unserializable Object] inner'
		);
		consoleSpy.mockRestore();
	});

	it("should use the message of an error or cause that has no stack", () => {
		const consoleSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const cause = new Error("root");
		cause.stack = undefined;
		const error = new Error("outer", { cause });
		error.stack = undefined;

		new PlainLogService().error(error);

		expect(consoleSpy.mock.calls[0][0]).toBe(
			"error: outer\nCaused by: root"
		);
		consoleSpy.mockRestore();
	});
});
