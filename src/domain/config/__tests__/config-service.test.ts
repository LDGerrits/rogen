import "../config.js";
import { ResultError } from "../../../base/result.js";
import {
	DiagnosticSeverity,
	errorDiagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import {
	requireValidConfigs,
	resolvedConfigs,
	resolvedEntries,
} from "../config-service.js";
import { mockEntry } from "./mock-config-service.js";

describe("domain/config/config-service", () => {
	describe("resolvedEntries and resolvedConfigs", () => {
		const unresolved = {
			...mockEntry({}, "/repo/broken.rogen.json"),
			resolved: undefined,
		};

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
				{
					...mockEntry({}, "/repo/prod.rogen.json"),
					diagnostics: [problem],
				},
			];

			const result = requireValidConfigs(entries);

			const error = (result as ResultError<DiagnosticsError>).error;
			expect(error.diagnostics).toEqual([problem]);
			expect(error.message).toBe(
				`/repo/prod.rogen.json:2:3 - error: unknown field "x".`
			);
		});

		it("should fail for an entry that has a last valid config but a broken file", () => {
			const entries = [{ ...mockEntry(), diagnostics: [problem] }];

			expect(requireValidConfigs(entries).isErr()).toBe(true);
		});

		it("should not fail on warnings", () => {
			const warning = warningDiagnostic(
				"x.warn",
				{ resource: "/repo/a.rogen.json" },
				"careful."
			);
			const entries = [{ ...mockEntry(), diagnostics: [warning] }];

			expect(warning.severity).toBe(DiagnosticSeverity.Warning);
			expect(requireValidConfigs(entries).isOk()).toBe(true);
		});
	});
});
