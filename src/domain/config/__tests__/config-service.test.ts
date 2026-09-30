import "../config.js";
import { ResultError } from "../../../base/result.js";
import {
	DiagnosticSeverity,
	errorDiagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import {
	brokenConfigsError,
	requireValidConfigs,
	resolvedConfigs,
	resolvedEntries,
} from "../config-service.js";
import { mockEntry } from "./mock-config-service.js";

describe("domain/config/config-service", () => {
	describe("ConfigEntry", () => {
		it("should list its errors and leave out its warnings", () => {
			const error = errorDiagnostic("x.err", { resource: "/a" }, "bad.");
			const warning = warningDiagnostic(
				"x.warn",
				{ resource: "/a" },
				"careful."
			);
			const entry = mockEntry({}, undefined, {
				diagnostics: [warning, error],
			});

			expect(entry.errors).toEqual([error]);
		});
	});

	describe("brokenConfigsError", () => {
		const error = errorDiagnostic("x.err", { resource: "/a" }, "bad.");

		it("should count the configs with errors out of all of them", () => {
			const entries = [
				mockEntry({}, "/repo/a.rogen.json"),
				mockEntry({}, "/repo/b.rogen.json", { diagnostics: [error] }),
				mockEntry({}, "/repo/c.rogen.json", { diagnostics: [error] }),
			];

			expect(brokenConfigsError(entries)?.message).toBe(
				"2 of 3 configs have errors."
			);
		});

		it("should count a config that never resolved, even without errors", () => {
			const entries = [
				mockEntry({}, "/repo/a.rogen.json", { resolved: undefined }),
			];

			expect(brokenConfigsError(entries)?.message).toBe(
				"1 of 1 configs have errors."
			);
		});

		it("should be undefined when none is broken", () => {
			expect(brokenConfigsError([mockEntry()])).toBeUndefined();
		});
	});

	describe("resolvedEntries and resolvedConfigs", () => {
		const unresolved = mockEntry({}, "/repo/broken.rogen.json", {
			resolved: undefined,
		});

		it("should pair each config that resolved with its entry and skip the rest", () => {
			const good = mockEntry(
				{ rootDirs: ["/repo/a"] },
				"/repo/a.rogen.json"
			);
			const pairs = resolvedEntries([unresolved, good]);

			expect(pairs).toHaveLength(1);
			expect(pairs[0].entry).toBe(good);
			expect(pairs[0].config).toBe(good.resolved);
		});

		it("should list only the configs that resolved", () => {
			const good = mockEntry(
				{ rootDirs: ["/repo/a"] },
				"/repo/a.rogen.json"
			);
			const entries = [good, unresolved];

			expect(resolvedConfigs(entries)).toEqual([good.resolved]);
		});
	});

	describe("requireValidConfigs", () => {
		const problem = errorDiagnostic(
			"config.unknownField",
			{
				resource: "/repo/prod.rogen.json",
				position: { line: 2, column: 3 },
			},
			'unknown field "x".'
		);

		it("should return every resolved config when all are valid", () => {
			const entries = [
				mockEntry({ rootDirs: ["/repo/a"] }, "/repo/a.rogen.json"),
				mockEntry({ rootDirs: ["/repo/b"] }, "/repo/b.rogen.json"),
			];

			const result = requireValidConfigs(entries);

			expect(result.unwrap().map((c) => c.rootDirs)).toEqual([
				["/repo/a"],
				["/repo/b"],
			]);
		});

		it("should fail with the errors of every invalid entry", () => {
			const entries = [
				mockEntry({}, "/repo/a.rogen.json"),
				mockEntry({}, "/repo/prod.rogen.json", {
					diagnostics: [problem],
				}),
			];

			const result = requireValidConfigs(entries);

			const error = (result as ResultError<DiagnosticsError>).error;
			expect(error.diagnostics).toEqual([problem]);
			expect(error.message).toBe(
				`/repo/prod.rogen.json:2:3 - error: unknown field "x".`
			);
		});

		it("should fail for an entry that has a last valid config but a broken file", () => {
			const entries = [
				mockEntry({}, undefined, { diagnostics: [problem] }),
			];

			expect(requireValidConfigs(entries).isErr()).toBe(true);
		});

		it("should not fail on warnings", () => {
			const warning = warningDiagnostic(
				"x.warn",
				{ resource: "/repo/a.rogen.json" },
				"careful."
			);
			const entries = [
				mockEntry({}, undefined, { diagnostics: [warning] }),
			];

			expect(warning.severity).toBe(DiagnosticSeverity.Warning);
			expect(requireValidConfigs(entries).isOk()).toBe(true);
		});
	});
});
