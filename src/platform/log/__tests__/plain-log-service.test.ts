import { jest } from "@jest/globals";
import {
	errorDiagnostic,
	warningDiagnostic,
} from "../../diagnostics/diagnostic.js";
import { LogLevel } from "../log-service.js";
import { PlainLogService } from "../plain-log-service.js";

describe("PlainLogService", () => {
	let out: string[];
	let errors: string[];

	beforeEach(() => {
		out = [];
		errors = [];
		jest.spyOn(console, "info").mockImplementation((line) => {
			out.push(String(line));
		});
		jest.spyOn(console, "debug").mockImplementation((line) => {
			out.push(String(line));
		});
		jest.spyOn(console, "warn").mockImplementation((line) => {
			errors.push(String(line));
		});
		jest.spyOn(console, "error").mockImplementation((line) => {
			errors.push(String(line));
		});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("should print a diagnostic without a second severity prefix", () => {
		const logService = new PlainLogService();

		logService.diagnostic(
			warningDiagnostic(
				"x.y",
				{ resource: "/repo/a.project.json" },
				"6 files matched no route."
			)
		);
		logService.diagnostic(
			errorDiagnostic(
				"x.z",
				{
					resource: "/repo/a.rogen.json",
					position: { line: 3, column: 2 },
				},
				"unknown field."
			)
		);

		expect(errors).toEqual([
			"/repo/a.project.json - warning: 6 files matched no route.",
			"/repo/a.rogen.json:3:2 - error: unknown field.",
		]);
	});

	it("should indent what a step holds and nothing else", () => {
		const logService = new PlainLogService();

		logService.intro("rogen list");
		logService.info("Not building: a.rogen.json.");
		logService.step("default.rogen.json");
		logService.success("Wrote default.project.json.");
		logService.info("root dirs: src\nsync dir: (none)");
		logService.diagnostic(
			warningDiagnostic("x.y", { resource: "/repo/a" }, "w")
		);
		logService.outro("1 config.");

		expect(out).toEqual([
			"rogen list",
			"Not building: a.rogen.json.",
			"default.rogen.json",
			"  Wrote default.project.json.",
			"  root dirs: src\n  sync dir: (none)",
			"1 config.",
		]);
		expect(errors).toEqual(["/repo/a - warning: w"]);
	});

	it("should prefix plain warnings and errors and tag debug lines", () => {
		const logService = new PlainLogService();
		logService.setLevel(LogLevel.Debug);

		logService.warn("careful");
		logService.error("broken");
		logService.debug("detail");

		expect(errors).toEqual(["warning: careful", "error: broken"]);
		expect(out).toEqual(["[debug] detail"]);
	});

	it("should print only errors at the error level", () => {
		const logService = new PlainLogService();
		logService.setLevel(LogLevel.Error);

		logService.intro("rogen build");
		logService.success("Wrote x.");
		logService.warn("careful");
		logService.diagnostic(
			warningDiagnostic("x.y", { resource: "/repo/a" }, "w")
		);
		logService.diagnostic(
			errorDiagnostic("x.z", { resource: "/repo/a" }, "e")
		);
		logService.outro("done");

		expect(out).toEqual([]);
		expect(errors).toEqual(["/repo/a - error: e"]);
	});

	it("should print raw text as is", () => {
		new PlainLogService().print("rogen 2.0.0");

		expect(out).toEqual(["rogen 2.0.0"]);
	});

	it("should write no ANSI escapes", () => {
		const logService = new PlainLogService();
		logService.setLevel(LogLevel.Trace);

		logService.intro("a");
		logService.success("b");
		logService.warn("c");
		logService.debug("d");
		logService.trace("e");

		expect([...out, ...errors].join("")).not.toContain("\x1b");
	});
});
