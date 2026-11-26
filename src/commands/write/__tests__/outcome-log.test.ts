import { LogService } from "../../../platform/log/log-service.js";
import { instantiationOf } from "../../../platform/instantiation/__tests__/instantiation-of.js";
import path from "path";
import {
	WriteRun,
	WriteSummary,
	CheckedConfig,
	ConfigOutcome,
	FailedConfig,
	SyncWarnings,
	UnwrittenConfig,
	WrittenConfig,
} from "../../../domain/write/write.js";
import { ResolvedConfig } from "../../../domain/config/resolved-config.js";
import {
	Diagnostic,
	errorDiagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { LogLevel } from "../../../platform/log/log-service.js";
import { mockConfig } from "../../../domain/config/__tests__/mock-config-service.js";
import { OutcomeLog } from "../outcome-log.js";

const cwd = path.resolve("/repo");

const matchFile = path.join(cwd, "match", "default.rogen.json");

const debugLines = (dir: string, summary: WriteSummary): string[] => {
	const logService = new MockLogService();
	logService.setLevel(LogLevel.Debug);
	instantiationOf([LogService, logService])
		.createInstance(OutcomeLog, dir)
		.outcome(writtenOf(summary), []);
	return logService.texts("debug");
};

const failedOf = (
	errors: readonly Diagnostic[] = [],
	config: ResolvedConfig = mockConfig()
): ConfigOutcome => new FailedConfig(config, errors);

const failed = failedOf();

const writtenOf = (
	summary: WriteSummary,
	outcome: "wrote" | "unchanged" | "wouldWrite" | "notWritten" = "wrote",
	config: ResolvedConfig = mockConfig(),
	blockedBy: readonly string[] = [matchFile]
): ConfigOutcome => {
	const findings = { warnings: [], sync: SyncWarnings.known([]) };
	if (outcome === "notWritten")
		return new UnwrittenConfig(config, findings, summary, [], blockedBy);
	if (outcome === "wouldWrite")
		return new CheckedConfig(config, findings, summary, []);
	return new WrittenConfig(config, outcome, findings, summary, []);
};

const summaryOf = (overrides: Partial<WriteSummary> = {}): WriteSummary => ({
	roots: [],
	routes: [],
	unrouted: 0,
	replaced: 0,
	displaced: 0,
	...overrides,
});

const describeSummary = (summary: WriteSummary, dir: string) =>
	debugLines(dir, summary);

describe("OutcomeLog write lines", () => {
	it("should name each source path relative to the working directory", () => {
		expect(
			describeSummary(
				summaryOf({
					roots: [
						{
							sourcePath: path.join(cwd, "src"),
							files: 3,
							ignored: 0,
							mounted: 0,
							skippedLinks: 0,
						},
						{
							sourcePath: path.join(cwd, "lib"),
							files: 1,
							ignored: 2,
							mounted: 1,
							skippedLinks: 1,
						},
					],
				}),
				cwd
			)
		).toEqual([
			"src: 3 files",
			"lib: 1 file, 2 ignored, 1 mounted, 1 skipped link",
		]);
	});

	it("should give each route its target and file count", () => {
		expect(
			describeSummary(
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

	it("should count what was left out only when something was", () => {
		expect(describeSummary(summaryOf(), cwd)).toEqual([]);
		expect(
			describeSummary(
				summaryOf({ unrouted: 2, replaced: 1, displaced: 3 }),
				cwd
			)
		).toEqual([
			"left out: 2 unrouted, 1 replaced by a file with the same name, 3 displaced by the tree",
		]);
	});
});

describe("OutcomeLog.outcome", () => {
	const error = errorDiagnostic("x.err", { resource: "/repo/a" }, "bad.");

	const lines = (
		outcome: ConfigOutcome,
		diagnostics: ConfigOutcome["diagnostics"] = [],
		note?: string
	) => {
		const logService = new MockLogService();
		instantiationOf([LogService, logService])
			.createInstance(OutcomeLog, cwd)
			.outcome(outcome, diagnostics, {
				notes: [note],
			});
		return logService.entries.map(({ kind, text }) => [kind, text]);
	};

	it("should say a written config wrote or was unchanged", () => {
		expect(lines(writtenOf(summaryOf()))[0]).toEqual([
			"success",
			"Wrote default.project.json.",
		]);
		expect(lines(writtenOf(summaryOf(), "unchanged"))[0]).toEqual([
			"success",
			"default.project.json · unchanged",
		]);
	});

	it("should say an unchanged config in a line when it has something to show", () => {
		const logService = new MockLogService();
		instantiationOf([LogService, logService])
			.createInstance(OutcomeLog, cwd)
			.outcome(writtenOf(summaryOf(), "unchanged"), [error], {
				quiet: false,
			});

		expect(logService.entries[0]).toEqual({
			kind: "success",
			stream: "stdout",
			text: "default.project.json · unchanged",
		});
	});

	it("should say a checked config would be written unless told to keep quiet", () => {
		expect(lines(writtenOf(summaryOf(), "wouldWrite"))[0]).toEqual([
			"success",
			"default.project.json · would write",
		]);
	});

	it("should say a failed config, and one another config stopped, were not written", () => {
		expect(lines(failed)[0]).toEqual([
			"error",
			"default.project.json · not written",
		]);
		expect(lines(writtenOf(summaryOf(), "notWritten"))[0]).toEqual([
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
		expect(lines(writtenOf(summaryOf()), [], "first build")[0]).toEqual([
			"success",
			"Wrote default.project.json (first build).",
		]);
	});

	it("should end the line of a config it didn't write with the note", () => {
		expect(lines(failedOf([error]), [], "see above")[0]).toEqual([
			"error",
			"default.project.json · not written · see above",
		]);
	});
});

describe("OutcomeLog report", () => {
	const configNamed = (label: string) =>
		mockConfig({
			name: label,
			file: path.join(cwd, label, "default.rogen.json"),
		});

	const report = (outcomes: readonly ConfigOutcome[]) => {
		const logService = new MockLogService();
		instantiationOf([LogService, logService])
			.createInstance(OutcomeLog, cwd)
			.report(new WriteRun(outcomes));
		return logService.entries
			.filter(({ kind }) => kind === "error" || kind === "success")
			.map(({ text }) => text);
	};

	it("should say a clean config wasn't written because another failed", () => {
		expect(
			report([
				writtenOf(summaryOf(), "notWritten", configNamed("lobby"), [
					matchFile,
				]),
				failedOf([], configNamed("match")),
			])
		).toEqual([
			"lobby/default.project.json · not written · match/default.rogen.json failed",
			"match/default.project.json · not written",
		]);
	});

	it("should say only under -v that a check prepared a config, and claim no write", () => {
		const logService = new MockLogService();
		logService.setLevel(LogLevel.Debug);

		instantiationOf([LogService, logService])
			.createInstance(OutcomeLog, cwd)
			.report(
				new WriteRun([
					writtenOf(summaryOf(), "wouldWrite", configNamed("a")),
				]),
				undefined,
				"syncback",
				false
			);

		expect(logService.lines).toEqual([
			"debug: rogen syncback · a/default.rogen.json",
			"debug: a/default.project.json · checked",
		]);
	});

	it("should say a project file it wrote in one line, and one it left alone only under -v", () => {
		const said = (kind: "wrote" | "unchanged") => {
			const logService = new MockLogService();
			instantiationOf([LogService, logService])
				.createInstance(OutcomeLog, cwd)
				.report(
					new WriteRun([writtenOf(summaryOf(), kind)]),
					undefined,
					"build",
					true,
					{ said: "Built game.rbxl", failed: false }
				);
			return logService.lines;
		};

		expect(said("wrote")).toEqual([
			"success: Wrote default.project.json.",
			"outro: Built game.rbxl.",
		]);
		expect(said("unchanged")).toEqual(["outro: Built game.rbxl."]);
	});

	describe("configs that share a name", () => {
		const twin = (folder: string) =>
			mockConfig({
				name: "game",
				file: path.join(cwd, folder, "default.rogen.json"),
			});

		const entries = () => {
			const logService = new MockLogService();
			instantiationOf([LogService, logService])
				.createInstance(OutcomeLog, cwd)
				.report(
					new WriteRun([
						writtenOf(summaryOf(), "wrote", twin("lobby")),
						writtenOf(summaryOf(), "wrote", twin("arena")),
					])
				);
			return logService.entries;
		};

		it("should head the report with each config's file", () => {
			const [intro] = entries();

			expect(intro.text).toEqual(
				"rogen build · lobby/default.rogen.json, arena/default.rogen.json"
			);
		});

		it("should head each config's lines with its file", () => {
			expect(
				entries()
					.filter(({ kind }) => kind === "step")
					.map(({ text }) => text)
			).toEqual(["lobby/default.rogen.json", "arena/default.rogen.json"]);
		});
	});

	it("should name every config that failed", () => {
		expect(
			report([
				failedOf([], configNamed("arena")),
				writtenOf(summaryOf(), "notWritten", configNamed("lobby"), [
					path.join(cwd, "arena", "default.rogen.json"),
					matchFile,
				]),
				failedOf([], configNamed("match")),
			])[1]
		).toEqual(
			"lobby/default.project.json · not written · arena/default.rogen.json and match/default.rogen.json failed"
		);
	});

	describe("errors", () => {
		const all = (outcomes: readonly ConfigOutcome[]) => {
			const logService = new MockLogService();
			instantiationOf([LogService, logService])
				.createInstance(OutcomeLog, cwd)
				.report(new WriteRun(outcomes));
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
				"step: arena/default.rogen.json",
				"error: arena/default.project.json · not written",
				"diagnosticError: /repo/a - error: shared. (x.shared)",
				"step: match/default.rogen.json",
				"error: match/default.project.json · not written",
				"diagnosticError: /repo/b - error: other. (x.other)",
				"outro: write failed.",
			]);
		});

		it("should print an error a later config shares once and say so on its line", () => {
			expect(
				all([
					failedOf([shared], configNamed("arena")),
					failedOf([shared], configNamed("match")),
				])
			).toEqual([
				"step: arena/default.rogen.json",
				"error: arena/default.project.json · not written",
				"diagnosticError: /repo/a - error: shared. (x.shared)",
				"step: match/default.rogen.json",
				"error: match/default.project.json · not written · same errors as arena/default.rogen.json",
				"outro: write failed.",
			]);
		});

		it("should print only the new errors of a config that shares some, with no note", () => {
			expect(
				all([
					failedOf([shared], configNamed("arena")),
					failedOf([shared, other], configNamed("match")),
				]).slice(3)
			).toEqual([
				"step: match/default.rogen.json",
				"error: match/default.project.json · not written",
				"diagnosticError: /repo/b - error: other. (x.other)",
				"outro: write failed.",
			]);
		});

		it("should close nothing after the errors of a single config", () => {
			expect(all([failedOf([shared], configNamed("arena"))])).toEqual([
				"error: arena/default.project.json · not written",
				"diagnosticError: /repo/a - error: shared. (x.shared)",
			]);
		});
	});
});

describe("OutcomeLog report, warnings", () => {
	const configNamed = (label: string) =>
		mockConfig({
			name: label,
			file: path.join(cwd, label, "default.rogen.json"),
		});

	const writtenWith = (
		label: string,
		warnings: readonly Diagnostic[],
		syncWarnings: readonly Diagnostic[] = []
	): ConfigOutcome =>
		new WrittenConfig(
			configNamed(label),
			"wrote",
			{ warnings, sync: SyncWarnings.known(syncWarnings) },
			summaryOf(),
			[]
		);

	const all = (outcomes: readonly ConfigOutcome[]) => {
		const logService = new MockLogService();
		instantiationOf([LogService, logService])
			.createInstance(OutcomeLog, cwd)
			.report(new WriteRun(outcomes));
		return logService.entries
			.filter(({ kind }) => kind !== "intro")
			.map(({ kind, text }) => `${kind}: ${text}`);
	};

	const aboutSrc = (label: string) =>
		warningDiagnostic(
			"x.folder",
			{ resource: path.join(cwd, label, "default.rogen.json") },
			"1 folder is odd:\n  src/Sever"
		);

	it("should print a warning a later config shares once and say so on its line", () => {
		expect(
			all([
				writtenWith("arena", [aboutSrc("arena")]),
				writtenWith("match", [aboutSrc("match")]),
			])
		).toEqual([
			"step: arena/default.rogen.json",
			"success: Wrote arena/default.project.json.",
			"diagnosticWarning: /repo/arena/default.rogen.json - warning: 1 folder is odd: (x.folder)\n  src/Sever",
			"step: match/default.rogen.json",
			"success: Wrote match/default.project.json (same warnings as arena/default.rogen.json).",
			"outro: Wrote 2 projects with 1 warning.",
		]);
	});

	it("should print the warnings only a later config has, with no note", () => {
		const own = warningDiagnostic(
			"x.own",
			{ resource: path.join(cwd, "match/default.rogen.json") },
			"only here."
		);

		expect(
			all([
				writtenWith("arena", [aboutSrc("arena")]),
				writtenWith("match", [aboutSrc("match"), own]),
			]).slice(3)
		).toEqual([
			"step: match/default.rogen.json",
			"success: Wrote match/default.project.json.",
			"diagnosticWarning: /repo/match/default.rogen.json - warning: only here. (x.own)",
			"outro: Wrote 2 projects with 2 warnings.",
		]);
	});

	it("should treat a warning about a shared file as shared too", () => {
		const shared = warningDiagnostic(
			"x.file",
			{ resource: path.join(cwd, "src/A.luau") },
			"odd."
		);

		expect(
			all([
				writtenWith("arena", [], [shared]),
				writtenWith("match", [], [shared]),
			])[4]
		).toEqual(
			"success: Wrote match/default.project.json (same warnings as arena/default.rogen.json)."
		);
	});

	it("should keep both notes when the errors and the warnings are shared", () => {
		const error = errorDiagnostic(
			"x.err",
			{ resource: path.join(cwd, "src/B.luau") },
			"bad."
		);
		const failed = (label: string) =>
			new FailedConfig(configNamed(label), [error], {
				warnings: [aboutSrc(label)],
				sync: SyncWarnings.known([]),
			});

		expect(
			all([failed("arena"), failed("match")]).find((line) =>
				line.startsWith("error: match")
			)
		).toEqual(
			"error: match/default.project.json · not written · same errors as arena/default.rogen.json · same warnings as arena/default.rogen.json"
		);
	});
});

describe("OutcomeLog report, closing line", () => {
	const written = (warnings: number, label = "a") =>
		new WrittenConfig(
			mockConfig({
				name: label,
				file: path.join(cwd, label, "default.rogen.json"),
			}),
			"wrote",
			{
				warnings: Array.from({ length: warnings }, (_, n) =>
					warningDiagnostic(
						`x.w${n}`,
						{ resource: `/repo/src/F${n}.luau` },
						"bad."
					)
				),
				sync: SyncWarnings.known([]),
			},
			summaryOf(),
			[]
		);

	const closing = (warnings: number) => {
		const logService = new MockLogService();
		instantiationOf([LogService, logService])
			.createInstance(OutcomeLog, cwd)
			.report(new WriteRun([written(warnings), written(0, "b")]));
		return logService.lines.at(-1);
	};

	it("should count the configs it wrote when there are several", () => {
		expect(closing(0)).toBe("outro: Wrote 2 projects.");
	});

	it("should count the warnings", () => {
		expect(closing(1)).toBe("outro: Wrote 2 projects with 1 warning.");
		expect(closing(2)).toBe("outro: Wrote 2 projects with 2 warnings.");
	});

	it("should name what Rojo built, with the warnings", () => {
		const logService = new MockLogService();
		instantiationOf([LogService, logService])
			.createInstance(OutcomeLog, cwd)
			.report(new WriteRun([written(1)]), undefined, "build", true, {
				said: "Built game.rbxl",
				failed: false,
			});

		expect(logService.lines.at(-1)).toBe(
			"outro: Built game.rbxl with 1 warning."
		);
	});

	it("should claim nothing when Rojo failed", () => {
		const logService = new MockLogService();
		instantiationOf([LogService, logService])
			.createInstance(OutcomeLog, cwd)
			.report(new WriteRun([written(0)]), undefined, "build", true, {
				said: "Built game.rbxl",
				failed: true,
			});

		expect(logService.texts("outro")).toEqual([]);
	});

	it("should close the frame of several configs with the failure when Rojo failed", () => {
		const logService = new MockLogService();
		instantiationOf([LogService, logService])
			.createInstance(OutcomeLog, cwd)
			.report(
				new WriteRun([written(0), written(0, "b")]),
				undefined,
				"build",
				true,
				{ said: "Built game.rbxl", failed: true }
			);

		expect(logService.lines.at(-1)).toBe("outro: build failed.");
	});

	it("should count the configs it checked when it wrote none", () => {
		const logService = new MockLogService();
		instantiationOf([LogService, logService])
			.createInstance(OutcomeLog, cwd)
			.report(
				new WriteRun([written(0), written(0, "b")]),
				undefined,
				"syncback",
				false
			);

		expect(logService.lines.at(-1)).toBe("outro: Checked 2 projects.");
	});

	it("should name the folder it ran in when that is not the working directory", () => {
		const logService = new MockLogService();
		logService.setLevel(LogLevel.Debug);
		instantiationOf([LogService, logService])
			.createInstance(OutcomeLog, cwd)
			.report(new WriteRun([written(0)]), path.join(cwd, "games"));

		expect(logService.lines[0]).toEqual(
			"debug: rogen build · a/default.rogen.json · in games"
		);
	});

	it("should head an unchanged config of several only under -v", () => {
		const logService = new MockLogService();
		logService.setLevel(LogLevel.Debug);
		const unchanged = (label: string) =>
			writtenOf(
				summaryOf(),
				"unchanged",
				mockConfig({
					name: label,
					file: path.join(cwd, label, "default.rogen.json"),
				})
			);
		instantiationOf([LogService, logService])
			.createInstance(OutcomeLog, cwd)
			.report(new WriteRun([unchanged("a"), unchanged("b")]));

		expect(logService.texts("step")).toEqual([]);
		expect(logService.texts("debug")).toEqual(
			expect.arrayContaining([
				"a/default.rogen.json",
				"b/default.rogen.json",
			])
		);
	});
});

describe("OutcomeLog.diagnostics", () => {
	it("should annotate each diagnostic and print them grouped under the config", () => {
		const logService = new MockLogService({ annotationsIn: "/repo" });
		const dead = (n: number) =>
			warningDiagnostic(
				"tree.deadScript",
				{ resource: `/repo/src/F${n}.luau` },
				"bad."
			);

		instantiationOf([LogService, logService])
			.createInstance(OutcomeLog, cwd)
			.diagnostics([dead(0), dead(1)], "/repo/default.rogen.json");

		expect(logService.texts("annotation")).toHaveLength(2);
		expect(logService.texts("diagnosticWarning")).toEqual([
			expect.stringContaining(
				"2 scripts will never run where they land:"
			),
		]);
	});
});

describe("OutcomeLog report, when quiet", () => {
	const quietly = () => {
		const logService = new MockLogService();
		logService.setLevel(LogLevel.Error);
		instantiationOf([LogService, logService])
			.createInstance(OutcomeLog, cwd)
			.report(
				new WriteRun([
					new WrittenConfig(
						mockConfig(),
						"wrote",
						{
							warnings: [
								warningDiagnostic(
									"x.w",
									{ resource: "/repo/src/F.luau" },
									"bad."
								),
							],
							sync: SyncWarnings.known([]),
						},
						summaryOf(),
						[]
					),
				])
			);
		return logService.lines;
	};

	it("should print nothing of a warning", () => {
		expect(quietly()).toEqual([]);
	});
});
