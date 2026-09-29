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
} from "../valid-configs.js";
import { MockConfigService, mockEntry } from "./mock-config-service.js";

describe("domain/config/valid-configs", () => {
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
			const service = new MockConfigService([unresolved, good]);

			const entries = resolvedEntries(service);

			expect(entries).toHaveLength(1);
			expect(entries[0].entry).toBe(good);
			expect(entries[0].config).toBe(good.resolved);
		});

		it("should list only the configs that resolved", () => {
			const good = mockEntry(
				{ rootDirs: ["/repo/a"] },
				"/repo/a.rogen.json"
			);
			const service = new MockConfigService([good, unresolved]);

			expect(resolvedConfigs(service)).toEqual([good.resolved]);
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
			const service = new MockConfigService([
				mockEntry({ rootDirs: ["/repo/a"] }, "/repo/a.rogen.json"),
				mockEntry({ rootDirs: ["/repo/b"] }, "/repo/b.rogen.json"),
			]);

			const result = requireValidConfigs(service);

			expect(result.unwrap().map((c) => c.rootDirs)).toEqual([
				["/repo/a"],
				["/repo/b"],
			]);
		});

		it("should fail with the errors of every invalid entry", () => {
			const service = new MockConfigService([
				mockEntry({}, "/repo/a.rogen.json"),
				{
					...mockEntry({}, "/repo/prod.rogen.json"),
					diagnostics: [problem],
				},
			]);

			const result = requireValidConfigs(service);

			const error = (result as ResultError<DiagnosticsError>).error;
			expect(error.diagnostics).toEqual([problem]);
			expect(error.message).toBe(
				`/repo/prod.rogen.json:2:3 - error: unknown field "x".`
			);
		});

		it("should fail for an entry that has a last valid config but a broken file", () => {
			const service = new MockConfigService([
				{ ...mockEntry(), diagnostics: [problem] },
			]);

			expect(requireValidConfigs(service).isErr()).toBe(true);
		});

		it("should not fail on warnings", () => {
			const warning = warningDiagnostic(
				"x.warn",
				{ resource: "/repo/a.rogen.json" },
				"careful."
			);
			const service = new MockConfigService([
				{ ...mockEntry(), diagnostics: [warning] },
			]);

			expect(warning.severity).toBe(DiagnosticSeverity.Warning);
			expect(requireValidConfigs(service).isOk()).toBe(true);
		});
	});
});
