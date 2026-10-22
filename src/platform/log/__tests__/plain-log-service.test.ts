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

	it("should print a section as a title with its lines indented under it, although only errors are asked for", () => {
		const logService = new PlainLogService();
		logService.setLevel(LogLevel.Error);

		logService.section(
			"default.rogen.json",
			"source paths: src\ncompiled path: out"
		);

		expect(out).toEqual([
			"default.rogen.json",
			"  source paths: src\n  compiled path: out",
		]);
	});

	it("should write its own lines on stderr once stdout is reserved, and leave print and note on stdout", () => {
		const logService = new PlainLogService();
		logService.reserveStdout();

		logService.intro("rogen build · game");
		logService.step("building");
		logService.section("title", "body");
		logService.info("a line");
		logService.success("done");
		logService.outro("Built 1 config.");
		logService.print("what a program reads");
		logService.note("beside it");

		expect(out).toEqual(["what a program reads", "beside it"]);
		expect(errors).toEqual([
			"rogen build · game",
			"building",
			"title",
			"  body",
			"  a line",
			"  done",
			"Built 1 config.",
		]);
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
			"/repo/a.project.json - warning: 6 files matched no route. (x.y)",
			"/repo/a.rogen.json:3:2 - error: unknown field. (x.z)",
		]);
	});

	it("should indent what a step holds and nothing else", () => {
		const logService = new PlainLogService();

		logService.intro("rogen build");
		logService.info("Not building: a.rogen.json.");
		logService.step("default.rogen.json");
		logService.success("Wrote default.project.json.");
		logService.info("source paths: src\ncompiled path: (none)");
		logService.diagnostic(
			warningDiagnostic("x.y", { resource: "/repo/a" }, "w")
		);
		logService.outro("1 config.");

		expect(out).toEqual([
			"rogen build",
			"Not building: a.rogen.json.",
			"default.rogen.json",
			"  Wrote default.project.json.",
			"  source paths: src\n  compiled path: (none)",
			"1 config.",
		]);
		expect(errors).toEqual(["/repo/a - warning: w (x.y)"]);
	});

	it("should prefix plain warnings and errors and tag debug lines, all on stderr", () => {
		const logService = new PlainLogService();
		logService.setLevel(LogLevel.Debug);

		logService.warn("careful");
		logService.error("broken");
		logService.debug("detail");

		expect(errors).toEqual([
			"warning: careful",
			"error: broken",
			"[debug] detail",
		]);
		expect(out).toEqual([]);
	});

	it("should indent debug lines inside a step", () => {
		const logService = new PlainLogService();
		logService.setLevel(LogLevel.Debug);

		logService.step("default.rogen.json");
		logService.debug("detail");

		expect(out).toEqual(["default.rogen.json"]);
		expect(errors).toEqual(["  [debug] detail"]);
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
		expect(errors).toEqual(["/repo/a - error: e (x.z)"]);
	});

	it("should print raw text as is", () => {
		new PlainLogService().print("rogen 2.0.0");

		expect(out).toEqual(["rogen 2.0.0"]);
	});

	it("should print a note as is", () => {
		new PlainLogService().note("  require(game)");

		expect(out).toEqual(["  require(game)"]);
	});

	it("should print no note when logging is off", () => {
		const logService = new PlainLogService();
		logService.setLevel(LogLevel.Off);

		logService.note("  require(game)");

		expect(out).toEqual([]);
	});

	it("should print a notice on stderr, unless quiet", () => {
		const logService = new PlainLogService();

		logService.notice("Rogen 2.0.1 is out");
		logService.setLevel(LogLevel.Error);
		logService.notice("Rogen 2.0.2 is out");

		expect(errors).toEqual(["Rogen 2.0.1 is out"]);
		expect(out).toEqual([]);
	});

	it("should print raw text at the error level", () => {
		const logService = new PlainLogService();
		logService.setLevel(LogLevel.Error);

		logService.print("rogen 2.0.0");

		expect(out).toEqual(["rogen 2.0.0"]);
	});

	it("should print no raw text when logging is off", () => {
		const logService = new PlainLogService();
		logService.setLevel(LogLevel.Off);

		logService.print("rogen 2.0.0");

		expect(out).toEqual([]);
	});

	it("should close an open frame with the given message", () => {
		const logService = new PlainLogService();

		logService.intro("rogen build");
		logService.closeFrame("build failed.");

		expect(out).toEqual(["rogen build", "build failed."]);
	});

	it("should not close a frame that was never opened", () => {
		new PlainLogService().closeFrame("build failed.");

		expect(out).toEqual([]);
	});

	it("should not close a frame that was already closed", () => {
		const logService = new PlainLogService();

		logService.intro("rogen build");
		logService.outro("done");
		logService.closeFrame("build failed.");

		expect(out).toEqual(["rogen build", "done"]);
	});

	it("should not close a frame whose header was silenced", () => {
		const logService = new PlainLogService();
		logService.setLevel(LogLevel.Error);

		logService.intro("rogen build");
		logService.closeFrame("build failed.");

		expect(out).toEqual([]);
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

	it("should print diagnostics relative to the working directory it was given", () => {
		const logService = new PlainLogService("/repo");

		logService.diagnostic(
			warningDiagnostic("x.y", { resource: "/repo/src/a.luau" }, "w")
		);

		expect(errors).toEqual(["src/a.luau - warning: w (x.y)"]);
	});

	describe("annotate", () => {
		const diagnostic = warningDiagnostic(
			"tree.deadScript",
			{ resource: "/work/repo/src/Dead.luau" },
			"never runs."
		);

		it("should write the workflow commands of a diagnostic on stderr, when asked for a workspace", () => {
			const logService = new PlainLogService("/work/repo", "/work/repo");

			logService.annotate(diagnostic);

			expect(errors).toEqual([
				"::warning file=src/Dead.luau,title=tree.deadScript::never runs.",
			]);
			expect(out).toEqual([]);
		});

		it("should start the line at its first column, inside a step too, or GitHub would not read it", () => {
			const logService = new PlainLogService("/work/repo", "/work/repo");
			logService.section("default.rogen.json", "source paths: src");
			logService.step("lobby");

			logService.annotate(diagnostic);

			expect(errors.at(-1)?.startsWith("::warning ")).toBe(true);
		});

		it("should write nothing without a workspace", () => {
			new PlainLogService("/work/repo").annotate(diagnostic);

			expect(errors).toEqual([]);
		});

		it("should write them even when only errors are shown, since the pull request decides what to show", () => {
			const logService = new PlainLogService("/work/repo", "/work/repo");
			logService.setLevel(LogLevel.Error);

			logService.annotate(diagnostic);

			expect(errors).toHaveLength(1);
		});
	});
});
