import { jest } from "@jest/globals";
import { warningDiagnostic } from "../../diagnostics/diagnostic.js";
import { JsonLogService } from "../json-log-service.js";
import { LogLevel } from "../log-service.js";

describe("JsonLogService", () => {
	let out: string[];
	let errors: string[];

	beforeEach(() => {
		out = [];
		errors = [];
		jest.spyOn(console, "info").mockImplementation((line) => {
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

	it("should print the document on stdout and nothing else, debug lines included", () => {
		const logService = new JsonLogService();
		logService.setLevel(LogLevel.Trace);

		logService.intro("rogen build");
		logService.note("beside it");
		logService.notice("note: nope.luau: in no source path");
		logService.warn("careful");
		logService.error("Can't watch part of the project");
		logService.debug("detail");
		logService.trace("CommandService#executeCommand build");
		logService.diagnostic(
			warningDiagnostic("x.y", { resource: "/repo/a" }, "w")
		);
		logService.print('{"changed":true}');

		expect(out).toEqual(['{"changed":true}']);
		expect(errors).toEqual([]);
	});

	it("should print the document under --quiet", () => {
		const logService = new JsonLogService();
		logService.setLevel(LogLevel.Error);

		logService.print('{"changed":false}');

		expect(out).toEqual(['{"changed":false}']);
	});
});
