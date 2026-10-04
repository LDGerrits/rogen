import path from "path";
import {
	BuildSummary,
	ConfigBuild,
} from "../../../domain/build/build-service.js";
import { ConfigEntry } from "../../../domain/config/config-service.js";
import { errorDiagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { LogLevel } from "../../../platform/log/log-service.js";
import { mockConfig } from "../../../domain/config/__tests__/mock-config-service.js";
import { BuildLog } from "../build-log.js";

const cwd = path.resolve("/repo");

const debugLines = (
	dir: string,
	entry: ConfigEntry,
	summary?: BuildSummary
): string[] => {
	const logService = new MockLogService();
	logService.setLevel(LogLevel.Debug);
	const log = new BuildLog(logService, dir);
	log.outcome(entry, summary ? builtOf(summary) : failed, []);
	return logService.entries
		.filter(({ kind }) => kind === "debug")
		.map(({ text }) => text);
};

const failed: ConfigBuild = {
	config: mockConfig(),
	outcome: "failed",
	warnings: [],
	syncWarnings: [],
	errors: [],
};

const builtOf = (
	summary: BuildSummary,
	outcome: "wrote" | "unchanged" | "notWritten" = "wrote"
): ConfigBuild => ({
	config: mockConfig(),
	outcome,
	warnings: [],
	syncWarnings: [],
	errors: [],
	summary,
	readFiles: [],
});

const entryOf = (overrides: Partial<ConfigEntry> = {}): ConfigEntry =>
	new ConfigEntry({
		file: path.join(cwd, "match.rogen.json"),
		chain: [path.join(cwd, "match.rogen.json")],
		resolved: undefined,
		diagnostics: [],
		skippedTags: [],
		...overrides,
	});

const summaryOf = (overrides: Partial<BuildSummary> = {}): BuildSummary => ({
	roots: [],
	routes: [],
	tags: [],
	unrouted: 0,
	superseded: 0,
	displaced: 0,
	...overrides,
});

const describeConfig = (entry: ConfigEntry, dir: string) =>
	debugLines(dir, entry);

const describeBuild = (summary: BuildSummary, dir: string) =>
	debugLines(dir, entryOf(), summary);

describe("BuildLog config lines", () => {
	it("should say nothing about a config with no parent and no skipped tags", () => {
		expect(describeConfig(entryOf(), cwd)).toEqual([]);
	});

	it("should name the extends chain relative to the working directory", () => {
		expect(
			describeConfig(
				entryOf({
					chain: [
						path.join(cwd, "match.rogen.json"),
						path.join(cwd, "default.rogen.json"),
						path.join(cwd, "shared/base.rogen.json"),
					],
				}),
				cwd
			)
		).toEqual(["extends: default.rogen.json -> shared/base.rogen.json"]);
	});

	it("should name each tag flag the config does not declare", () => {
		expect(
			describeConfig(entryOf({ skippedTags: ["mock", "debug"] }), cwd)
		).toEqual([
			"tag mock skipped: not declared in this config",
			"tag debug skipped: not declared in this config",
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
							skippedLinks: 0,
						},
						{
							rootDir: path.join(cwd, "lib"),
							files: 1,
							excluded: 2,
							skippedLinks: 1,
						},
					],
				}),
				cwd
			)
		).toEqual(["src: 3 files", "lib: 1 file, 2 excluded, 1 skipped link"]);
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

	it("should say which tags are on and which left files out", () => {
		expect(
			describeBuild(
				summaryOf({
					tags: [
						{ tag: "mock", on: true, files: 2 },
						{ tag: "debug", on: false, files: 1 },
					],
				}),
				cwd
			)
		).toEqual(["tag mock on: 2 files", "tag debug off: 1 file left out"]);
	});

	it("should count what was left out only when something was", () => {
		expect(describeBuild(summaryOf(), cwd)).toEqual([]);
		expect(
			describeBuild(
				summaryOf({ unrouted: 2, superseded: 1, displaced: 3 }),
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
		diagnostics: ConfigBuild["errors"] = [],
		repeated = false
	) => {
		const logService = new MockLogService();
		new BuildLog(logService, cwd).outcome(
			entryOf(),
			build,
			diagnostics,
			repeated
		);
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
		expect(lines({ ...failed, errors: [error] }, [error])).toEqual([
			["error", "default.project.json · not written"],
			["diagnosticError", expect.stringContaining("bad.")],
		]);
	});

	it("should say when a config's errors were printed before", () => {
		expect(lines({ ...failed, errors: [error] }, [], true)[0]).toEqual([
			"error",
			"default.project.json · not written · same errors as before",
		]);
	});
});
