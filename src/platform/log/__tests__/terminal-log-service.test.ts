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
			"│  ▲ /repo/lobby.json - warning: w",
			"│",
			"└  Stopped.",
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
});
