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
	blockedBy: readonly ResolvedConfig[] = [mockConfig()]
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
					configNamed("match"),
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
					configNamed("arena"),
					configNamed("match"),
				]),
				failedOf([], configNamed("match")),
			])[1]
		).toBe("lobby.project.json · not written · arena and match failed");
	});
});
