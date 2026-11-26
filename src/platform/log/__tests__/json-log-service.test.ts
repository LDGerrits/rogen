import { jest } from "@jest/globals";
import { ReportedError } from "../../../base/errors.js";
import {
	errorDiagnostic,
	warningDiagnostic,
} from "../../diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../diagnostics/diagnostics-error.js";
import { JsonLogService } from "../json-log-service.js";

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

	const printed = () => out.map((text) => JSON.parse(text));

	it("should print the document on stdout and nothing else, debug lines included", () => {
		const logService = new JsonLogService();

		logService.intro("rogen build");
		logService.step("12:04:31");
		logService.info("Serving.");
		logService.success("Wrote default.project.json.");
		logService.outro("Built.");
		logService.closeFrame("Stopped.");
		logService.note("beside it");
		logService.notice("note: nope.luau: in no source path");
		logService.warn("careful");
		logService.error("Can't watch part of the project");
		logService.debug("detail");
		logService.trace("CommandService#executeCommand build");
		logService.diagnostics([
			warningDiagnostic("x.y", { resource: "/repo/a" }, "w"),
		]);
		logService.diagnostics(
			[warningDiagnostic("x.y", { resource: "/repo/a" }, "w")],
			{ asResult: true }
		);
		logService.result('{"changed":true}');

		expect(out).toEqual(['{"changed":true}']);
		expect(errors).toEqual([]);
	});

	describe("failure", () => {
		it("should print the diagnostics of a failure as a JSON document", () => {
			new JsonLogService().failure(
				new DiagnosticsError([
					errorDiagnostic("x.err", { resource: "/a" }, "bad."),
				]),
				"build"
			);

			expect(printed()).toMatchObject([
				{ diagnostics: [{ code: "x.err" }] },
			]);
			expect(errors).toEqual([]);
		});

		it("should print the message of another failure as a JSON document", () => {
			new JsonLogService().failure(new Error("no config"), "build");

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

		it("should print nothing for a failure the command already printed", () => {
			new JsonLogService().failure(
				new ReportedError(new Error("x")),
				"build"
			);

			expect(out).toEqual([]);
		});
	});

	describe("crash", () => {
		it("should print the message of a crash as a JSON document", () => {
			new JsonLogService().crash(new TypeError("x is undefined"));

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
			new JsonLogService().crash("boom");

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
	});
});
