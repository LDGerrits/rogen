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
		const logService = new TerminalLogService();
		logService.setLevel(LogLevel.Error);

		logService.notice("Rogen 2.0.1 is out");

		expect(error).not.toHaveBeenCalled();
	});

	it("should nest results and diagnostics under a step", () => {
		const logService = new TerminalLogService();

		logService.intro("rogen watch · default");
		logService.step("12:04:31 · 2 files changed");
		logService.success("default.project.json · 14ms");
		logService.diagnostic(
			warningDiagnostic("x.y", { resource: "/repo/lobby.json" }, "w")
		);
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
		logService.diagnostic(
			warningDiagnostic("x.y", { resource: "/repo/a" }, "w")
		);
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

	it("should write plain lines on stderr once stdout is reserved", () => {
		const info = jest.spyOn(console, "info").mockImplementation(() => {});
		const error = jest.spyOn(console, "error").mockImplementation(() => {});
		const logService = new TerminalLogService();
		logService.reserveStdout();

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

	it("should draw a section as a step with its lines under it, although only errors are asked for", () => {
		const logService = new TerminalLogService();
		logService.setLevel(LogLevel.Error);

		logService.section("default.rogen.json", "source paths: src");

		expect(drawn().split("\n").filter(Boolean)).toEqual([
			"│",
			"◇  default.rogen.json",
			"│  source paths: src",
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
		const logService = new TerminalLogService();
		logService.setLevel(LogLevel.Error);

		logService.print("rogen 2.0.0");

		expect(info).toHaveBeenCalledWith("rogen 2.0.0");
	});

	it("should keep the severity written by the diagnostic itself", () => {
		new TerminalLogService().diagnostic(
			warningDiagnostic("x.y", { resource: "/repo/a" }, "w")
		);

		expect(drawn()).not.toContain("warning: /repo");
	});

	it("should write the workflow commands of a diagnostic on stderr, undrawn, when asked for a workspace", () => {
		const error = jest.spyOn(console, "error").mockImplementation(() => {});

		new TerminalLogService("/work/repo", "/work/repo").annotate(
			warningDiagnostic(
				"tree.deadScript",
				{ resource: "/work/repo/src/Dead.luau" },
				"never runs."
			)
		);

		expect(error).toHaveBeenCalledWith(
			"::warning file=src/Dead.luau,title=tree.deadScript::never runs."
		);
		expect(drawn()).toBe("");
	});
});
