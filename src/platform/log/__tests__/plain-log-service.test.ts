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

	it("should write its own lines on stderr when they go there, and leave results and notes on stdout", () => {
		const logService = new PlainLogService({ ownLines: "stderr" });

		logService.intro("rogen build · game");
		logService.step("building");
		logService.info("a line");
		logService.success("done");
		logService.outro("Built 1 config.");
		logService.result("what a program reads");
		logService.note("beside it");

		expect(out).toEqual(["what a program reads", "beside it"]);
		expect(errors).toEqual([
			"rogen build · game",
			"building",
			"  a line",
			"  done",
			"Built 1 config.",
		]);
	});

	it("should print a diagnostic without a second severity prefix", () => {
		const logService = new PlainLogService();

		logService.diagnostics([
			warningDiagnostic(
				"x.y",
				{ resource: "/repo/a.project.json" },
				"6 files matched no route."
			),
		]);
		logService.diagnostics([
			errorDiagnostic(
				"x.z",
				{
					resource: "/repo/a.rogen.json",
					position: { line: 3, column: 2 },
				},
				"unknown field."
			),
		]);

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
		logService.diagnostics([
			warningDiagnostic("x.y", { resource: "/repo/a" }, "w"),
		]);
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
		const logService = new PlainLogService({ level: LogLevel.Debug });

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

	it("should colour the prefixes and debug lines when colour is on", () => {
		const logService = new PlainLogService({
			color: true,
			level: LogLevel.Debug,
		});

		logService.warn("careful");
		logService.error("broken");
		logService.debug("detail");

		expect(errors).toEqual([
			"\u001b[33mwarning:\u001b[39m careful",
			"\u001b[31merror:\u001b[39m broken",
			"\u001b[2m[debug] detail\u001b[22m",
		]);
	});

	it("should colour the severity of a diagnostic when colour is on", () => {
		const logService = new PlainLogService({ color: true });

		logService.diagnostics([
			warningDiagnostic("x.y", { resource: "/repo/a" }, "w"),
		]);
		logService.diagnostics([
			errorDiagnostic("x.z", { resource: "/repo/a\u001b[0m" }, "e"),
		]);

		expect(errors).toEqual([
			"/repo/a - \u001b[33mwarning:\u001b[39m w (x.y)",
			"/repo/a\\u001b[0m - \u001b[31merror:\u001b[39m e (x.z)",
		]);
	});

	it("should indent debug lines inside a step", () => {
		const logService = new PlainLogService({ level: LogLevel.Debug });

		logService.step("default.rogen.json");
		logService.debug("detail");

		expect(out).toEqual(["default.rogen.json"]);
		expect(errors).toEqual(["  [debug] detail"]);
	});

	it("should print only errors at the error level", () => {
		const logService = new PlainLogService({ level: LogLevel.Error });

		logService.intro("rogen build");
		logService.success("Wrote x.");
		logService.warn("careful");
		logService.diagnostics([
			warningDiagnostic("x.y", { resource: "/repo/a" }, "w"),
		]);
		logService.diagnostics([
			errorDiagnostic("x.z", { resource: "/repo/a" }, "e"),
		]);
		logService.outro("done");

		expect(out).toEqual([]);
		expect(errors).toEqual(["/repo/a - error: e (x.z)"]);
	});

	it("should print nothing at all when logging is off", () => {
		const logService = new PlainLogService({ level: LogLevel.Off });

		logService.error("broken");
		logService.info("Serving.");
		logService.debug("detail");
		logService.trace("more detail");
		logService.step("12:04:31");

		expect(out).toEqual([]);
		expect(errors).toEqual([]);
	});

	it("should print raw text as is", () => {
		new PlainLogService().result("rogen 2.0.0");

		expect(out).toEqual(["rogen 2.0.0"]);
	});

	it("should print a note as is", () => {
		new PlainLogService().note("  require(game)");

		expect(out).toEqual(["  require(game)"]);
	});

	it("should print no note when logging is off", () => {
		const logService = new PlainLogService({ level: LogLevel.Off });

		logService.note("  require(game)");

		expect(out).toEqual([]);
	});

	it("should print a notice on stderr, unless quiet", () => {
		new PlainLogService().notice("Rogen 2.0.1 is out");
		new PlainLogService({ level: LogLevel.Error }).notice(
			"Rogen 2.0.2 is out"
		);

		expect(errors).toEqual(["Rogen 2.0.1 is out"]);
		expect(out).toEqual([]);
	});

	it("should print raw text at the error level", () => {
		const logService = new PlainLogService({ level: LogLevel.Error });

		logService.result("rogen 2.0.0");

		expect(out).toEqual(["rogen 2.0.0"]);
	});

	it("should print no raw text when logging is off", () => {
		const logService = new PlainLogService({ level: LogLevel.Off });

		logService.result("rogen 2.0.0");

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
		const logService = new PlainLogService({ level: LogLevel.Error });

		logService.intro("rogen build");
		logService.closeFrame("build failed.");

		expect(out).toEqual([]);
	});

	it("should write no ANSI escapes", () => {
		const logService = new PlainLogService({ level: LogLevel.Trace });

		logService.intro("a");
		logService.success("b");
		logService.warn("c");
		logService.debug("d");
		logService.trace("e");

		expect([...out, ...errors].join("")).not.toContain("\x1b");
	});

	it("should print diagnostics relative to the working directory it was given", () => {
		const logService = new PlainLogService({ cwd: "/repo" });

		logService.diagnostics([
			warningDiagnostic("x.y", { resource: "/repo/src/a.luau" }, "w"),
		]);

		expect(errors).toEqual(["src/a.luau - warning: w (x.y)"]);
	});

	describe("diagnostics", () => {
		const diagnostic = warningDiagnostic(
			"tree.deadScript",
			{ resource: "/work/repo/src/Dead.luau" },
			"never runs."
		);
		const annotated = (options = {}) =>
			new PlainLogService({
				cwd: "/work/repo",
				annotationsIn: "/work/repo",
				...options,
			});

		it("should write the workflow command of each diagnostic on stderr, before the diagnostics, when asked for a workspace", () => {
			annotated().diagnostics([
				diagnostic,
				errorDiagnostic(
					"meta.wrongType",
					{ resource: "/work/repo/src/init.meta.json" },
					"wrong."
				),
			]);

			expect(errors).toEqual([
				"::warning file=src/Dead.luau,title=tree.deadScript::never runs.",
				"::error file=src/init.meta.json,title=meta.wrongType::wrong.",
				"src/Dead.luau - warning: never runs. (tree.deadScript)",
				"src/init.meta.json - error: wrong. (meta.wrongType)",
			]);
			expect(out).toEqual([]);
		});

		it("should start the line at its first column, inside a step too, or GitHub would not read it", () => {
			const logService = annotated();
			logService.step("lobby");

			logService.diagnostics([diagnostic]);

			expect(errors[0]).toBe(
				"::warning file=src/Dead.luau,title=tree.deadScript::never runs."
			);
		});

		it("should write no workflow command without a workspace", () => {
			new PlainLogService({ cwd: "/work/repo" }).diagnostics([
				diagnostic,
			]);

			expect(errors).toEqual([
				"src/Dead.luau - warning: never runs. (tree.deadScript)",
			]);
		});

		it("should annotate and show only the errors when only errors are shown, as --quiet asks", () => {
			annotated({ level: LogLevel.Error }).diagnostics([
				diagnostic,
				errorDiagnostic(
					"meta.wrongType",
					{ resource: "/work/repo/src/init.meta.json" },
					"wrong."
				),
			]);

			expect(errors).toEqual([
				"::error file=src/init.meta.json,title=meta.wrongType::wrong.",
				"src/init.meta.json - error: wrong. (meta.wrongType)",
			]);
		});

		it("should show what the presentation makes of them, and annotate each one found", () => {
			annotated().diagnostics([diagnostic, diagnostic], {
				present: ([first]) => [
					{ ...first, message: "2 scripts never run." },
				],
			});

			expect(errors).toEqual([
				"::warning file=src/Dead.luau,title=tree.deadScript::never runs.",
				"::warning file=src/Dead.luau,title=tree.deadScript::never runs.",
				"src/Dead.luau - warning: 2 scripts never run. (tree.deadScript)",
			]);
		});

		it("should print them as the result on stdout, under --quiet too, with the severity coloured when colour is on", () => {
			annotated({ level: LogLevel.Error, color: true }).diagnostics(
				[diagnostic],
				{ asResult: true }
			);

			expect(out).toEqual([
				"src/Dead.luau - \u001b[33mwarning:\u001b[39m never runs. (tree.deadScript)",
			]);
			expect(errors).toEqual([]);
		});

		it("should print them as the result without escapes when colour is off", () => {
			annotated().diagnostics([diagnostic], { asResult: true });

			expect(out).toEqual([
				"src/Dead.luau - warning: never runs. (tree.deadScript)",
			]);
			expect(errors).toEqual([
				"::warning file=src/Dead.luau,title=tree.deadScript::never runs.",
			]);
		});
	});
});
