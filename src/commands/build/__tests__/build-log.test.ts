import path from "path";
import {
	BuildSummary,
	ConfigBuild,
	FailedBuild,
	UnwrittenBuild,
	WrittenBuild,
} from "../../../domain/build/build.js";
import { ResolvedConfig } from "../../../domain/config/config.js";
import {
	Diagnostic,
	errorDiagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { LogLevel } from "../../../platform/log/log-service.js";
import {
	ResolvedConfigSpec,
	mockConfig,
} from "../../../domain/config/__tests__/mock-config-service.js";
import { BuildLog } from "../build-log.js";

const cwd = path.resolve("/repo");

const debugLines = (
	dir: string,
	config: ResolvedConfig,
	summary?: BuildSummary
): string[] => {
	const logService = new MockLogService();
	logService.setLevel(LogLevel.Debug);
	const log = new BuildLog(logService, dir);
	log.outcome(
		summary ? builtOf(summary, "wrote", config) : failedOf([], config),
		[]
	);
	return logService.entries
		.filter(({ kind }) => kind === "debug")
		.map(({ text }) => text);
};

const failedOf = (
	errors: readonly Diagnostic[] = [],
	config: ResolvedConfig = mockConfig()
): ConfigBuild => new FailedBuild(config, errors);

const failed = failedOf();

const builtOf = (
	summary: BuildSummary,
	outcome: "wrote" | "unchanged" | "notWritten" = "wrote",
	config: ResolvedConfig = mockConfig(),
	blockedBy: readonly string[] = ["match"]
): ConfigBuild => {
	const findings = { warnings: [], syncWarnings: [] };
	return outcome === "notWritten"
		? new UnwrittenBuild(config, findings, summary, [], blockedBy)
		: new WrittenBuild(config, outcome, findings, summary, []);
};

const configOf = (spec: ResolvedConfigSpec = {}): ResolvedConfig =>
	mockConfig({ file: path.join(cwd, "match.rogen.json"), ...spec });

const summaryOf = (overrides: Partial<BuildSummary> = {}): BuildSummary => ({
	roots: [],
	routes: [],
	variants: [],
	unrouted: 0,
	replaced: 0,
	displaced: 0,
	...overrides,
});

const describeConfig = (config: ResolvedConfig, dir: string) =>
	debugLines(dir, config);

const describeBuild = (summary: BuildSummary, dir: string) =>
	debugLines(dir, configOf(), summary);

describe("BuildLog config lines", () => {
	it("should say nothing about a config with no parent and no skipped variants", () => {
		expect(describeConfig(configOf(), cwd)).toEqual([]);
	});

	it("should name the extends chain relative to the working directory", () => {
		expect(
			describeConfig(
				configOf({
					parents: [
						path.join(cwd, "default.rogen.json"),
						path.join(cwd, "shared/base.rogen.json"),
					],
				}),
				cwd
			)
		).toEqual(["extends: default.rogen.json -> shared/base.rogen.json"]);
	});

	it("should name each variant flag the config does not declare", () => {
		expect(
			describeConfig(
				configOf({ skippedVariants: ["mock", "debug"] }),
				cwd
			)
		).toEqual([
			"variant mock skipped: not declared in this config",
			"variant debug skipped: not declared in this config",
		]);
	});
});

describe("BuildLog build lines", () => {
	it("should name each root dir relative to the working directory", () => {
		expect(
			describeBuild(
				summaryOf({
					roots: [
						{
							rootDir: path.join(cwd, "src"),
							files: 3,
							excluded: 0,
							mounted: 0,
							skippedLinks: 0,
						},
						{
							rootDir: path.join(cwd, "lib"),
							files: 1,
							excluded: 2,
							mounted: 1,
							skippedLinks: 1,
						},
					],
				}),
				cwd
			)
		).toEqual([
			"src: 3 files",
			"lib: 1 file, 2 excluded, 1 mounted, 1 skipped link",
		]);
	});

	it("should give each route its target and file count", () => {
		expect(
			describeBuild(
				summaryOf({
					routes: [
						{
							key: "server",
							target: "ServerScriptService",
							files: 1,
						},
						{ key: "*", target: "ReplicatedStorage", files: 0 },
					],
				}),
				cwd
			)
		).toEqual([
			"route server -> ServerScriptService: 1 file",
			"route * -> ReplicatedStorage: 0 files",
		]);
	});

	it("should say which variants are on and which left files out", () => {
		expect(
			describeBuild(
				summaryOf({
					variants: [
						{ variant: "mock", on: true, files: 2 },
						{ variant: "debug", on: false, files: 1 },
					],
				}),
				cwd
			)
		).toEqual([
			"variant mock on: 2 files",
			"variant debug off: 1 file left out",
		]);
	});

	it("should count what was left out only when something was", () => {
		expect(describeBuild(summaryOf(), cwd)).toEqual([]);
		expect(
			describeBuild(
				summaryOf({ unrouted: 2, replaced: 1, displaced: 3 }),
				cwd
			)
		).toEqual([
			"left out: 2 unrouted, 1 replaced by a file with the same name, 3 displaced by the template",
		]);
	});
});

describe("BuildLog.outcome", () => {
	const error = errorDiagnostic("x.err", { resource: "/repo/a" }, "bad.");

	const lines = (
		build: ConfigBuild,
		diagnostics: ConfigBuild["diagnostics"] = [],
		note?: string
	) => {
		const logService = new MockLogService();
		new BuildLog(logService, cwd).outcome(build, diagnostics, note);
		return logService.entries.map(({ kind, text }) => [kind, text]);
	};

	it("should say a written config wrote or was unchanged", () => {
		expect(lines(builtOf(summaryOf()))[0]).toEqual([
			"success",
			"default.project.json · wrote",
		]);
		expect(lines(builtOf(summaryOf(), "unchanged"))[0]).toEqual([
			"success",
			"default.project.json · unchanged",
		]);
	});

	it("should say a failed config, and one another config stopped, were not written", () => {
		expect(lines(failed)[0]).toEqual([
			"error",
			"default.project.json · not written",
		]);
		expect(lines(builtOf(summaryOf(), "notWritten"))[0]).toEqual([
			"error",
			"default.project.json · not written",
		]);
	});

	it("should print the diagnostics it is given after the line", () => {
		expect(lines(failedOf([error]), [error])).toEqual([
			["error", "default.project.json · not written"],
			["diagnosticError", expect.stringContaining("bad.")],
		]);
	});

	it("should end the line of a written config with the note", () => {
		expect(lines(builtOf(summaryOf()), [], "first build")[0]).toEqual([
			"success",
			"default.project.json · wrote · first build",
		]);
	});

	it("should end the line of a config it didn't write with the note", () => {
		expect(lines(failedOf([error]), [], "see above")[0]).toEqual([
			"error",
			"default.project.json · not written · see above",
		]);
	});
});

describe("BuildLog report", () => {
	const configNamed = (label: string) =>
		mockConfig({
			file: path.join(cwd, `${label}.rogen.json`),
			outFile: path.join(cwd, `${label}.project.json`),
		});

	const report = (builds: readonly ConfigBuild[]) => {
		const logService = new MockLogService();
		new BuildLog(logService, cwd).report(builds);
		return logService.entries
			.filter(({ kind }) => kind === "error" || kind === "success")
			.map(({ text }) => text);
	};

	it("should say a clean config wasn't written because another failed", () => {
		expect(
			report([
				builtOf(summaryOf(), "notWritten", configNamed("lobby"), [
					"match",
				]),
				failedOf([], configNamed("match")),
			])
		).toEqual([
			"lobby.project.json · not written · match failed",
			"match.project.json · not written",
		]);
	});

	it("should name every config that failed", () => {
		expect(
			report([
				failedOf([], configNamed("arena")),
				builtOf(summaryOf(), "notWritten", configNamed("lobby"), [
					"arena",
					"match",
				]),
				failedOf([], configNamed("match")),
			])[1]
		).toBe("lobby.project.json · not written · arena and match failed");
	});

	describe("errors", () => {
		const all = (builds: readonly ConfigBuild[]) => {
			const logService = new MockLogService();
			new BuildLog(logService, cwd).report(builds);
			return logService.entries
				.filter(({ kind }) => kind !== "intro")
				.map(({ kind, text }) => `${kind}: ${text}`);
		};
		const shared = errorDiagnostic(
			"x.shared",
			{ resource: "/repo/a" },
			"shared."
		);
		const other = errorDiagnostic(
			"x.other",
			{ resource: "/repo/b" },
			"other."
		);

		it("should print a failed config's errors under its own line", () => {
			expect(
				all([
					failedOf([shared], configNamed("arena")),
					failedOf([other], configNamed("match")),
				])
			).toEqual([
				"step: arena",
				"error: arena.project.json · not written",
				"diagnosticError: /repo/a - error: shared.",
				"step: match",
				"error: match.project.json · not written",
				"diagnosticError: /repo/b - error: other.",
				"outro: build failed.",
			]);
		});

		it("should print an error a later config shares once and say so on its line", () => {
			expect(
				all([
					failedOf([shared], configNamed("arena")),
					failedOf([shared], configNamed("match")),
				])
			).toEqual([
				"step: arena",
				"error: arena.project.json · not written",
				"diagnosticError: /repo/a - error: shared.",
				"step: match",
				"error: match.project.json · not written · same errors as arena",
				"outro: build failed.",
			]);
		});

		it("should print only the new errors of a config that shares some, with no note", () => {
			expect(
				all([
					failedOf([shared], configNamed("arena")),
					failedOf([shared, other], configNamed("match")),
				]).slice(3)
			).toEqual([
				"step: match",
				"error: match.project.json · not written",
				"diagnosticError: /repo/b - error: other.",
				"outro: build failed.",
			]);
		});

		it("should close the frame with the failure and not with the built line", () => {
			expect(all([failedOf([shared], configNamed("arena"))])).toEqual([
				"error: arena.project.json · not written",
				"diagnosticError: /repo/a - error: shared.",
				"outro: build failed.",
			]);
		});
	});
});

describe("BuildLog.diagnostics", () => {
	const warnings = (count: number, code = "route.unrouted") =>
		Array.from({ length: count }, (_, n) =>
			warningDiagnostic(
				code,
				{ resource: `/repo/src/F${n}.luau` },
				"bad."
			)
		);

	const printed = (diagnostics: readonly Diagnostic[]) => {
		const logService = new MockLogService();
		new BuildLog(logService, cwd).diagnostics(diagnostics);
		return logService.entries.map(({ text }) => text);
	};

	it("should print at most ten warnings of one code, the tenth saying how many more there are", () => {
		const lines = printed(warnings(12));

		expect(lines).toHaveLength(10);
		expect(lines[9]).toContain("bad. 2 more like it aren't listed.");
		expect(lines[8]).not.toContain("more like it");
	});

	it("should say 'isn't' for one more", () => {
		expect(printed(warnings(11))[9]).toContain(
			"1 more like it isn't listed."
		);
	});

	it("should print exactly ten without a note", () => {
		expect(printed(warnings(10))[9]).not.toContain("more like it");
	});

	it("should print ten of the related files a grouped warning lists, then count the rest", () => {
		const related = Array.from({ length: 12 }, (_, n) => ({
			resource: `/repo/src/F${n}`,
			message: "hint",
		}));
		const grouped = warningDiagnostic(
			"route.strayAt",
			{ resource: "/repo/default.rogen.json" },
			[
				"12 names:",
				...related.map(({ resource }) => `  ${resource} (hint)`),
				"Fix them.",
			].join("\n"),
			[],
			related
		);

		const [text] = printed([grouped]);

		const lines = text.split("\n");
		expect(lines).toHaveLength(13);
		expect(lines[10]).toContain("/repo/src/F9 (hint)");
		expect(lines[11]).toBe("  2 more like it aren't listed.");
		expect(lines[12]).toBe("Fix them.");
	});

	it("should cap each code on its own and never an error", () => {
		const errors = Array.from({ length: 12 }, (_, n) =>
			errorDiagnostic("x.err", { resource: `/repo/e${n}` }, "boom.")
		);

		const lines = printed([
			...warnings(11, "a.code"),
			...warnings(11, "b.code"),
			...errors,
		]);

		expect(lines).toHaveLength(32);
	});
});
