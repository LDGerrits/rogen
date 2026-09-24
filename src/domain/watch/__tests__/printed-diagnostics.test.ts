import {
	errorDiagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import { PrintedDiagnostics } from "../printed-diagnostics.js";

const warning = (message: string) =>
	warningDiagnostic("x.warn", { resource: "/repo/src" }, message);

describe("domain/watch/printed-diagnostics", () => {
	it("should report everything the first time", () => {
		const printed = new PrintedDiagnostics();
		const diagnostics = [warning("a"), warning("b")];

		expect(printed.unseen("default", diagnostics)).toEqual(diagnostics);
	});

	it("should not report a diagnostic again while it persists", () => {
		const printed = new PrintedDiagnostics();
		printed.unseen("default", [warning("a")]);

		expect(printed.unseen("default", [warning("a"), warning("b")])).toEqual(
			[warning("b")]
		);
	});

	it("should report a diagnostic again after it went away", () => {
		const printed = new PrintedDiagnostics();
		printed.unseen("default", [warning("a")]);
		printed.unseen("default", []);

		expect(printed.unseen("default", [warning("a")])).toEqual([
			warning("a"),
		]);
	});

	it("should track each key on its own", () => {
		const printed = new PrintedDiagnostics();
		printed.unseen("default", [warning("a")]);

		expect(printed.unseen("source", [warning("a")])).toEqual([
			warning("a"),
		]);
	});

	it("should tell apart diagnostics that differ only in severity", () => {
		const printed = new PrintedDiagnostics();
		printed.unseen("default", [warning("a")]);
		const error = errorDiagnostic("x.warn", { resource: "/repo/src" }, "a");

		expect(printed.unseen("default", [error])).toEqual([error]);
	});
});
