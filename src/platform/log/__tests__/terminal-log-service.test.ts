import { jest } from "@jest/globals";
import { stripVTControlCharacters } from "util";
import { warningDiagnostic } from "../../diagnostics/diagnostic.js";
import { LogLevel } from "../log-service.js";
import { TerminalLogService } from "../terminal-log-service.js";

describe("TerminalLogService", () => {
	let written: string;

	beforeEach(() => {
		written = "";
		jest.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			written += String(chunk);
			return true;
		});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	const drawn = () => stripVTControlCharacters(written);

	it("should write a note as it is, dimmed where there are colours", () => {
		const info = jest.spyOn(console, "info").mockImplementation(() => {});

		new TerminalLogService().note("  require(game)");

		expect(info).toHaveBeenCalledTimes(1);
		expect(stripVTControlCharacters(String(info.mock.calls[0][0]))).toBe(
			"  require(game)"
		);
	});

	it("should write a notice on stderr, dimmed where there are colours", () => {
		const info = jest.spyOn(console, "info").mockImplementation(() => {});
		const error = jest.spyOn(console, "error").mockImplementation(() => {});

		new TerminalLogService().notice("Rogen 2.0.1 is out");

		expect(info).not.toHaveBeenCalled();
		expect(stripVTControlCharacters(String(error.mock.calls[0][0]))).toBe(
			"Rogen 2.0.1 is out"
		);
	});

	it("should write no notice under --quiet", () => {
		const error = jest.spyOn(console, "error").mockImplementation(() => {});
		const logService = new TerminalLogService({
			level: LogLevel.Error,
		});

		logService.notice("Rogen 2.0.1 is out");

		expect(error).not.toHaveBeenCalled();
	});

	it("should nest results and diagnostics under a step", () => {
		const logService = new TerminalLogService();

		logService.intro("rogen watch · default");
		logService.step("12:04:31 · 2 files changed");
		logService.success("default.project.json · 14ms");
		logService.diagnostics([
			warningDiagnostic("x.y", { resource: "/repo/lobby.json" }, "w"),
		]);
		logService.outro("Stopped.");

		expect(drawn().split("\n").filter(Boolean)).toEqual([
			"┌  rogen watch · default",
			"│",
			"◇  12:04:31 · 2 files changed",
			"│  ✔ default.project.json · 14ms",
			"│  ▲ /repo/lobby.json - warning: w (x.y)",
			"│",
			"└  Stopped.",
		]);
	});

	it("should write plain lines, with no frame, when none is open", () => {
		const lines: string[] = [];
		const keep = (text: unknown) => {
			lines.push(stripVTControlCharacters(String(text)));
		};
		jest.spyOn(console, "info").mockImplementation(keep);
		jest.spyOn(console, "error").mockImplementation(keep);
		const logService = new TerminalLogService();

		logService.success("Wrote default.project.json.");
		logService.diagnostics([
			warningDiagnostic("x.y", { resource: "/repo/a" }, "w"),
		]);
		logService.error("broken");
		logService.outro("Built game.rbxl.");

		expect(drawn()).toBe("");
		expect(lines).toEqual([
			"Wrote default.project.json.",
			"▲ /repo/a - warning: w (x.y)",
			"■ broken",
			"Built game.rbxl.",
		]);
	});

	it("should draw the same frame without colour when colour is off", () => {
		const logService = new TerminalLogService();

		logService.intro("rogen build");
		logService.success("Wrote default.project.json.");
		logService.outro("Built game.rbxl.");

		expect(written).toContain("✔ Wrote default.project.json.");
		expect(written).toBe(drawn());
	});

	it("should colour its symbols when colour is on", () => {
		const logService = new TerminalLogService({ color: true });

		logService.intro("rogen build");
		logService.success("Wrote default.project.json.");

		expect(written).not.toBe(drawn());
	});

	it("should write plain lines without colour when colour is off", () => {
		const error = jest.spyOn(console, "error").mockImplementation(() => {});
		const logService = new TerminalLogService({
			level: LogLevel.Debug,
		});

		logService.error("broken");
		logService.debug("detail");

		expect(error.mock.calls.map(([line]) => line)).toEqual([
			"■ broken",
			"detail",
		]);
	});

	it("should write plain lines on stderr once its own lines go to stderr", () => {
		const info = jest.spyOn(console, "info").mockImplementation(() => {});
		const error = jest.spyOn(console, "error").mockImplementation(() => {});
		const logService = new TerminalLogService({ ownLines: "stderr" });

		logService.success("Wrote default.project.json.");
		logService.info("Syncing 2 instances.");
		logService.outro("Synced back.");

		expect(info).not.toHaveBeenCalled();
		expect(error.mock.calls.map(([line]) => line)).toEqual([
			"Wrote default.project.json.",
			"Syncing 2 instances.",
			"Synced back.",
		]);
	});

	it("should draw its frame on stderr when its own lines go there", () => {
		let drawnOnStderr = "";
		jest.spyOn(process.stderr, "write").mockImplementation((chunk) => {
			drawnOnStderr += String(chunk);
			return true;
		});
		const logService = new TerminalLogService({ ownLines: "stderr" });

		logService.intro("rogen syncback");
		logService.step("default.rogen.json");
		logService.warn("careful");

		expect(drawn()).toBe("");
		expect(
			stripVTControlCharacters(drawnOnStderr).split("\n").filter(Boolean)
		).toEqual([
			"┌  rogen syncback",
			"│",
			"◇  default.rogen.json",
			"│  ▲ careful",
		]);
	});

	it("should close an open frame after the error", () => {
		const logService = new TerminalLogService();

		logService.intro("rogen build");
		logService.error("broken");
		logService.closeFrame("build failed.");

		expect(drawn().split("\n").filter(Boolean)).toEqual([
			"┌  rogen build",
			"│  ■ broken",
			"│",
			"└  build failed.",
		]);
	});

	it("should print raw text at the error level", () => {
		const info = jest.spyOn(console, "info").mockImplementation(() => {});
		const logService = new TerminalLogService({
			level: LogLevel.Error,
		});

		logService.result("rogen 2.0.0");

		expect(info).toHaveBeenCalledWith("rogen 2.0.0");
	});

	it("should keep the severity written by the diagnostic itself", () => {
		new TerminalLogService().diagnostics([
			warningDiagnostic("x.y", { resource: "/repo/a" }, "w"),
		]);

		expect(drawn()).not.toContain("warning: /repo");
	});

	it("should write the workflow commands of a diagnostic on stderr, undrawn, when asked for a workspace", () => {
		const error = jest.spyOn(console, "error").mockImplementation(() => {});
		const logService = new TerminalLogService({
			cwd: "/work/repo",
			annotationsIn: "/work/repo",
		});
		logService.intro("rogen build");

		logService.diagnostics([
			warningDiagnostic(
				"tree.deadScript",
				{ resource: "/work/repo/src/Dead.luau" },
				"never runs."
			),
		]);

		expect(error).toHaveBeenCalledWith(
			"::warning file=src/Dead.luau,title=tree.deadScript::never runs."
		);
		expect(drawn()).not.toContain("::warning");
	});

	it("should nest warnings, information and debug lines under an open frame", () => {
		const logService = new TerminalLogService({
			level: LogLevel.Trace,
		});

		logService.intro("rogen serve");
		logService.warn("careful");
		logService.info("Serving.");
		logService.debug("detail");
		logService.trace("more detail");

		expect(drawn().split("\n").filter(Boolean)).toEqual([
			"┌  rogen serve",
			"│  ▲ careful",
			"│  Serving.",
			"│  detail",
			"│  more detail",
		]);
	});

	it("should write a warning on stderr when no frame is open", () => {
		const error = jest.spyOn(console, "error").mockImplementation(() => {});

		new TerminalLogService().warn("careful");

		expect(error).toHaveBeenCalledWith("▲ careful");
	});
});
