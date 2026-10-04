import { jest } from "@jest/globals";
import { ResultError } from "../../../base/result.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfig } from "../config.js";
import { ConfigSelection, buildableConfig } from "../config-service.js";
import { CoreConfigService } from "../core-config-service.js";

interface Refs {
	readonly names?: string[];
	readonly paths?: string[];
	readonly all?: boolean;
	readonly overrides?: {
		readonly outFile?: string;
		readonly syncDir?: string;
		readonly template?: string;
		readonly variants: Record<string, boolean>;
	};
}

describe("domain/config/core-config-service", () => {
	let fs: MemoryFileSystemService;
	let service: CoreConfigService;
	let selection: ConfigSelection;

	const write = (file: string, config: Record<string, unknown> | string) =>
		fs.writeFile(
			file,
			typeof config === "string" ? config : JSON.stringify(config)
		);

	const plain = (config: ResolvedConfig | undefined) =>
		config && {
			file: config.file,
			name: config.name,
			rootDirs: config.rootDirs,
			routes: Object.fromEntries(
				[...config.routes].map(([key, target]) => [key, String(target)])
			),
			variants: config.variants,
			exclude: config.exclude,
			syncDir: config.syncDir,
			outFile: config.outFile,
			template: config.template && {
				file: config.template.file,
				project: config.template.project.getTree(),
			},
		};

	/** Selects the configs `refs` names, as the matching command line would. */
	const start = async (
		{ names = [], paths, all, overrides }: Refs = {},
		cwd = "/repo"
	) => {
		const variants = Object.entries(overrides?.variants ?? {});
		service = new CoreConfigService(
			fs,
			new MockEnvironmentService({ _: [] }, cwd)
		);
		const result = await service.select({
			_: ["build", ...names],
			config: paths,
			all,
			"out-file": overrides?.outFile,
			"sync-dir": overrides?.syncDir,
			template: overrides?.template,
			variant: variants
				.filter(([, on]) => on)
				.map(([variant]) => variant),
			"no-variant": variants
				.filter(([, on]) => !on)
				.map(([variant]) => variant),
		});
		if (result.isOk()) selection = result.value;
		return result;
	};

	const resolved = (index = 0) => buildableConfig(selection.entries[index]);

	const errors = (index = 0) => {
		const entry = selection.entries[index];
		return entry.status === "broken" ? entry.errors : [];
	};

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo");
		service = new CoreConfigService(
			fs,
			new MockEnvironmentService({ _: [] }, "/repo")
		);
	});

	describe("select", () => {
		it("should select the configs it loaded, and name the config files here it left out, sorted", async () => {
			await write("/repo/match.rogen.json", {});
			await write("/repo/default.rogen.json", {});
			await write("/repo/lobby.rogen.json", {});
			await fs.writeFile("/repo/README.md", "");
			await fs.createDirectory("/repo/dir.rogen.json");
			await write("/repo/nested/other.rogen.json", {});

			const selection = (await start({ names: ["lobby"] })).unwrap();

			expect(selection.entries.map(({ file }) => file)).toEqual([
				"/repo/lobby.rogen.json",
			]);
			expect(selection.unselected).toEqual([
				"/repo/default.rogen.json",
				"/repo/match.rogen.json",
			]);
		});

		it("should leave out nothing when it loads every config", async () => {
			await write("/repo/default.rogen.json", {});
			await write("/repo/lobby.rogen.json", {});

			const selection = (await start({ all: true })).unwrap();

			expect(selection.unselected).toEqual([]);
		});

		const refusal = async (refs: Refs) => {
			await write("/repo/lobby.rogen.json", {});
			await write("/repo/match.rogen.json", {});
			const result = await start(refs);
			return result.isErr() ? result.error.message : "";
		};

		it.each([
			["-o", { outFile: "a.json" }],
			["-s", { syncDir: "dist" }],
			["--template", { template: "t.json" }],
		])("should refuse %s with several configs", async (flag, override) => {
			expect(
				await refusal({
					names: ["lobby", "match"],
					overrides: { ...override, variants: {} },
				})
			).toBe(
				`${flag} targets a single config, but several were named. Name one config, or set it in the file.`
			);
		});

		it("should count -c paths towards the several configs", async () => {
			expect(
				await refusal({
					names: ["lobby"],
					paths: ["match.rogen.json"],
					overrides: { outFile: "a.json", variants: {} },
				})
			).toMatch(/^-o targets a single config/);
		});

		it("should refuse -o with every config", async () => {
			expect(
				await refusal({
					all: true,
					overrides: { outFile: "a.json", variants: {} },
				})
			).toMatch(/^-o targets a single config/);
		});

		it("should allow -o with one config", async () => {
			await write("/repo/lobby.rogen.json", {});

			const result = await start({
				names: ["lobby"],
				overrides: { outFile: "a.json", variants: {} },
			});

			expect(result.isOk()).toBe(true);
		});

		it.each<[string, Refs]>([
			["a name", { names: ["lobby"] }],
			["a -c path", { paths: ["lobby.rogen.json"] }],
		])("should refuse every config with %s", async (_what, refs) => {
			expect(await refusal({ all: true, ...refs })).toBe(
				"--all already builds every config here, so it takes no names or -c paths. Drop one or the other."
			);
		});

		it("should resolve the default config with defaults applied", async () => {
			await write("/repo/default.rogen.json", {});

			expect((await start()).isOk()).toBe(true);

			const [entry] = selection.entries;
			expect(entry.file).toBe("/repo/default.rogen.json");
			expect(entry.status).toBe("valid");
			expect(plain(resolved(0))).toMatchObject({
				rootDirs: ["/repo/src"],
				routes: {},
				variants: {},
				exclude: [],
				outFile: "/repo/default.project.json",
			});
		});

		it("should resolve several named configs in one service", async () => {
			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			await write("/repo/source.rogen.json", { rootDirs: ["b"] });

			await start({ names: ["default", "source"] });

			expect(
				selection.entries.map((c) => buildableConfig(c)?.rootDirs)
			).toEqual([["/repo/a"], ["/repo/b"]]);
		});

		it("should fail when discovery fails", async () => {
			const result = await start({ names: ["nope"] });

			expect((result as ResultError<Error>).error.message).toContain(
				'Config "nope" not found'
			);
		});

		it("should put a broken config's errors on its own entry only", async () => {
			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			await write("/repo/prod.rogen.json", { bogus: true });

			await start({ names: ["default", "prod"] });

			expect(selection.entries.map(({ status }) => status)).toEqual([
				"valid",
				"broken",
			]);
			expect(errors(1)).toMatchObject([
				{
					code: "config.unknownField",
					resource: "/repo/prod.rogen.json",
					position: { line: 1, column: 2 },
				},
			]);
		});

		it("should leave resolved undefined for a config that was never valid", async () => {
			await write("/repo/default.rogen.json", "{ nope");

			await start();

			expect(resolved(0)).toBeUndefined();
		});

		it("should select two configs writing the same outFile", async () => {
			await write("/repo/a.rogen.json", { outFile: "same.project.json" });
			await write("/repo/b.rogen.json", { outFile: "same.project.json" });

			const result = await start({ names: ["a", "b"] });

			expect(result.isOk()).toBe(true);
			expect(selection.entries.map((_, index) => errors(index))).toEqual([
				[],
				[],
			]);
		});

		it("should list every file of every chain", async () => {
			await write("/repo/base.rogen.json", {});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
			});

			await start();

			expect(selection.files).toEqual(
				new Set(["/repo/default.rogen.json", "/repo/base.rogen.json"])
			);
		});
	});

	describe("selection", () => {
		it("should read every config here for a scope of all when none is named", async () => {
			await write("/repo/a.rogen.json", {});
			await write("/repo/b.rogen.json", {});

			const result = await service.select(
				{ _: ["list"] },
				{ unnamed: "all" }
			);

			expect(result.unwrap().entries.map(({ file }) => file)).toEqual([
				"/repo/a.rogen.json",
				"/repo/b.rogen.json",
			]);
		});

		it("should return every config when all are valid", async () => {
			await write("/repo/a.rogen.json", { rootDirs: ["a"] });
			await write("/repo/b.rogen.json", { rootDirs: ["b"] });
			await start({ names: ["a", "b"] });

			expect(
				selection
					.requireValid()
					.unwrap()
					.map(({ rootDirs }) => rootDirs)
			).toEqual([["/repo/a"], ["/repo/b"]]);
			expect(selection.brokenError).toBeUndefined();
		});

		it("should fail with the errors of every broken config, and count them", async () => {
			await write("/repo/a.rogen.json", {});
			await write("/repo/b.rogen.json", { bogus: 1 });
			await write("/repo/c.rogen.json", "{ nope");
			await start({ names: ["a", "b", "c"] });

			const result = selection.requireValid();

			expect(
				(result as ResultError<DiagnosticsError>).error.diagnostics
			).toEqual([...errors(1), ...errors(2)]);
			expect(selection.brokenError?.message).toBe(
				"2 of 3 configs have errors."
			);
		});

		it("should fail for a config that is broken now but has a last valid version", async () => {
			await write("/repo/default.rogen.json", {});
			await start();
			await write("/repo/default.rogen.json", { bogus: 1 });
			await selection.reload(["/repo/default.rogen.json"]);

			expect(selection.requireValid().isErr()).toBe(true);
		});
	});

	describe("read", () => {
		it("should resolve a config file without adding it to the configs", async () => {
			await write("/repo/other.rogen.json", { rootDirs: ["lib"] });

			const entry = await service.read("/repo/other.rogen.json");

			expect(buildableConfig(entry)?.rootDirs).toEqual(["/repo/lib"]);
			expect(entry.status).toBe("valid");
		});

		it("should follow the extends chain", async () => {
			await write("/repo/base.rogen.json", { syncDir: "out" });
			await write("/repo/other.rogen.json", {
				extends: "./base.rogen.json",
			});

			const entry = await service.read("/repo/other.rogen.json");

			expect(entry.parents).toEqual(["/repo/base.rogen.json"]);
			expect(buildableConfig(entry)?.syncDir).toBe("/repo/out");
		});

		it("should put the problems of a broken config on the entry", async () => {
			await write("/repo/other.rogen.json", "{ nope");

			const entry = await service.read("/repo/other.rogen.json");

			expect(entry).toMatchObject({
				status: "broken",
				lastValid: undefined,
			});
		});
	});

	describe("unnamed config", () => {
		it("should fail a config file with no name before .rogen.json", async () => {
			await write("/repo/.rogen.json", { rootDirs: ["src"] });

			const entry = await service.read("/repo/.rogen.json");

			expect(entry).toMatchObject({
				status: "broken",
				errors: [
					{
						code: "config.unnamed",
						resource: "/repo/.rogen.json",
						message: expect.stringContaining(
							"Rename it to <name>.rogen.json"
						),
					},
				],
			});
		});
	});

	describe("registerFileCheck", () => {
		const hint = (file: string) => ({
			severity: DiagnosticSeverity.Warning,
			code: "test.hint",
			resource: file,
			message: "a hint",
		});

		it("should add a check's hints to the errors of a file that fails to load", async () => {
			await write("/repo/a.rogen.json", { nope: true });
			service.registerFileCheck(({ file }) => [hint(file)]);

			const entry = await service.read("/repo/a.rogen.json");

			expect(entry.status).toBe("broken");
			if (entry.status === "broken")
				expect(entry.errors.map(({ code }) => code)).toEqual([
					"config.unknownField",
					"test.hint",
				]);
		});

		it("should hand the check what the file holds, or nothing when it doesn't parse", async () => {
			await write("/repo/a.rogen.json", { nope: true });
			await write("/repo/b.rogen.json", "{ nope");
			const seen: unknown[] = [];
			service.registerFileCheck(({ value }) => {
				seen.push(value);
				return [];
			});

			await service.read("/repo/a.rogen.json");
			await service.read("/repo/b.rogen.json");

			expect(seen).toEqual([{ nope: true }, undefined]);
		});

		it("should never run on a config that loads", async () => {
			await write("/repo/a.rogen.json", { rootDirs: ["src"] });
			const check = jest.fn(() => []);
			service.registerFileCheck(check);

			const entry = await service.read("/repo/a.rogen.json");

			expect(entry.status).toBe("valid");
			expect(check).not.toHaveBeenCalled();
		});

		it("should run on an unnamed config", async () => {
			await write("/repo/.rogen.json", { source: ["src"] });
			service.registerFileCheck(({ file }) => [hint(file)]);

			const entry = await service.read("/repo/.rogen.json");

			expect(
				entry.status === "broken" &&
					entry.errors.map(({ code }) => code)
			).toEqual(["config.unnamed", "test.hint"]);
		});

		it("should stop running once the registration is disposed", async () => {
			await write("/repo/a.rogen.json", { nope: true });
			const check = jest.fn(() => []);
			const registration = service.registerFileCheck(check);

			registration[Symbol.dispose]();
			await service.read("/repo/a.rogen.json");

			expect(check).not.toHaveBeenCalled();
		});
	});

	describe("extends", () => {
		it("should merge maps key by key with the child winning", async () => {
			await write("/repo/base.rogen.json", {
				routes: { server: "ServerScriptService", "*": "ServerStorage" },
				variants: { mock: false, debug: true },
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
				routes: {
					"*": "ReplicatedStorage/shared",
					client: "StarterGui",
				},
				variants: { mock: true },
			});

			await start();

			expect(plain(resolved(0))).toMatchObject({
				routes: {
					server: "ServerScriptService",
					"*": "ReplicatedStorage/shared",
					client: "StarterGui",
				},
				variants: { mock: true, debug: true },
			});
		});

		it("should replace lists wholesale", async () => {
			await write("/repo/base.rogen.json", {
				rootDirs: ["core"],
				exclude: ["**/*.spec.luau", "**/*.story.luau"],
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
				rootDirs: ["core", "places/lobby"],
				exclude: ["**/*.spec.luau"],
			});

			await start();

			expect(resolved(0)).toMatchObject({
				rootDirs: ["/repo/core", "/repo/places/lobby"],
				exclude: ["/repo/**/*.spec.luau"],
			});
		});

		it("should inherit a field the child leaves out and replace one it sets", async () => {
			await write("/repo/one.project.json", { tree: {} });
			await write("/repo/source.rogen.json", {
				rootDirs: ["src"],
				template: "one.project.json",
				syncDir: "out",
			});
			await write("/repo/default.rogen.json", {
				extends: "./source.rogen.json",
				syncDir: "dist",
			});

			await start();

			expect(resolved(0)).toMatchObject({
				rootDirs: ["/repo/src"],
				template: { file: "/repo/one.project.json" },
				syncDir: "/repo/dist",
			});
		});

		it("should resolve a parent's relative paths against the parent's directory", async () => {
			await fs.createDirectory("/repo/shared");
			await fs.createDirectory("/repo/places");
			await write("/repo/shared/template.project.json", { tree: {} });
			await write("/repo/shared/core.rogen.json", {
				rootDirs: ["src"],
				exclude: ["**/*.spec.luau"],
				template: "template.project.json",
				syncDir: "out",
			});
			await write("/repo/places/default.rogen.json", {
				extends: "../shared/core.rogen.json",
			});

			await start({ paths: ["places/default.rogen.json"] });

			expect(resolved(0)).toMatchObject({
				rootDirs: ["/repo/shared/src"],
				exclude: ["/repo/shared/**/*.spec.luau"],
				template: { file: "/repo/shared/template.project.json" },
				syncDir: "/repo/shared/out",
			});
		});

		it("should never inherit outFile", async () => {
			await write("/repo/base.rogen.json", {
				outFile: "shared.project.json",
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
			});

			await start();

			expect(resolved(0)?.outFile).toBe("/repo/default.project.json");
		});

		it("should keep the leaf's own outFile", async () => {
			await write("/repo/base.rogen.json", {
				outFile: "shared.project.json",
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
				outFile: "build/game.project.json",
			});

			await start();

			expect(resolved(0)?.outFile).toBe("/repo/build/game.project.json");
		});

		it("should resolve a three-deep chain from the outermost ancestor inwards", async () => {
			await write("/repo/core.rogen.json", {
				rootDirs: ["core"],
				routes: { server: "ServerScriptService", client: "StarterGui" },
				variants: { mock: false },
			});
			await write("/repo/lobby-source.rogen.json", {
				extends: "./core.rogen.json",
				rootDirs: ["core", "places/lobby"],
				routes: { client: "StarterPlayer/StarterPlayerScripts" },
			});
			await write("/repo/lobby.rogen.json", {
				extends: "./lobby-source.rogen.json",
				syncDir: "dist/lobby",
				variants: { mock: true },
			});

			await start({ names: ["lobby"] });

			expect(selection.entries[0].parents).toEqual([
				"/repo/lobby-source.rogen.json",
				"/repo/core.rogen.json",
			]);
			expect(plain(resolved(0))).toEqual({
				file: "/repo/lobby.rogen.json",
				name: "repo",
				rootDirs: ["/repo/core", "/repo/places/lobby"],
				routes: {
					server: "ServerScriptService",
					client: "StarterPlayer/StarterPlayerScripts",
				},
				variants: { mock: true },
				exclude: [],
				syncDir: "/repo/dist/lobby",
				outFile: "/repo/lobby.project.json",
			});
		});

		it("should read each file in the chain exactly once", async () => {
			const reads: string[] = [];
			class RecordingFileSystemService extends MemoryFileSystemService {
				override async readFile(filePath: string): Promise<string> {
					reads.push(filePath);
					return super.readFile(filePath);
				}
			}
			fs = new RecordingFileSystemService();
			await fs.createDirectory("/repo");
			service = new CoreConfigService(
				fs,
				new MockEnvironmentService({ _: [] }, "/repo")
			);
			await write("/repo/core.rogen.json", { rootDirs: ["core"] });
			await write("/repo/default.rogen.json", {
				extends: "./core.rogen.json",
			});

			await start();

			expect(reads.sort()).toEqual([
				"/repo/core.rogen.json",
				"/repo/default.rogen.json",
			]);
		});

		it("should report a self-referencing config as a cycle", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"extends": "./default.rogen.json"
}`
			);

			await start();

			expect(errors(0)).toEqual([
				{
					severity: DiagnosticSeverity.Error,
					code: "config.extendsCycle",
					message:
						"extends cycle: /repo/default.rogen.json -> /repo/default.rogen.json.",
					resource: "/repo/default.rogen.json",
					position: { line: 2, column: 13 },
				},
			]);
		});

		it("should name every file in a cycle", async () => {
			await write("/repo/default.rogen.json", {
				extends: "./b.rogen.json",
			});
			await write("/repo/b.rogen.json", { extends: "./c.rogen.json" });
			await write("/repo/c.rogen.json", { extends: "./b.rogen.json" });

			await start();

			const [diagnostic] = errors(0);
			expect(diagnostic.resource).toBe("/repo/c.rogen.json");
			expect(diagnostic.message).toBe(
				"extends cycle: /repo/b.rogen.json -> /repo/c.rogen.json -> /repo/b.rogen.json."
			);
		});

		it("should report a missing extends target with its path and the referring file", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"extends": "./missing.rogen.json"
}`
			);

			await start();

			const [diagnostic] = errors(0);
			expect(diagnostic).toMatchObject({
				severity: DiagnosticSeverity.Error,
				code: "config.extendsUnreadable",
				resource: "/repo/default.rogen.json",
				position: { line: 2, column: 13 },
			});
			expect(diagnostic.message).toContain("/repo/missing.rogen.json");
		});

		it("should report the diagnostics of an invalid ancestor against that file", async () => {
			await write("/repo/base.rogen.json", { bogus: true });
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
			});

			await start();

			expect(errors(0)).toMatchObject([
				{
					resource: "/repo/base.rogen.json",
					code: "config.unknownField",
				},
			]);
			expect(selection.files).toContain("/repo/base.rogen.json");
		});

		it("should reject null in an ancestor's routes and variants", async () => {
			await write("/repo/base.rogen.json", {
				routes: { server: null },
				variants: { mock: null },
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
			});

			await start();

			expect(errors(0).map((d) => [d.resource, d.message])).toEqual([
				[
					"/repo/base.rogen.json",
					'"routes.server": expected a string, found null.',
				],
				[
					"/repo/base.rogen.json",
					'"variants.mock": expected a boolean, found null.',
				],
			]);
		});

		it("should keep a trailing slash on an excluded directory", async () => {
			await write("/repo/default.rogen.json", { exclude: ["dist/"] });

			await start();

			expect(resolved(0)?.exclude).toEqual(["/repo/dist/"]);
		});
	});

	describe("reload", () => {
		it("should report each config whose value changed, in selection order", async () => {
			await write("/repo/base.rogen.json", { rootDirs: ["a"] });
			await write("/repo/one.rogen.json", {
				extends: "./base.rogen.json",
			});
			await write("/repo/two.rogen.json", {
				extends: "./base.rogen.json",
			});
			await write("/repo/other.rogen.json", { rootDirs: ["z"] });
			await start({ names: ["one", "two", "other"] });

			await write("/repo/base.rogen.json", { rootDirs: ["b"] });
			const reload = await selection.reload(["/repo/base.rogen.json"]);

			expect(reload).toEqual({
				changed: ["/repo/one.rogen.json", "/repo/two.rogen.json"],
				notices: [],
			});
			expect(resolved(0)?.rootDirs).toEqual(["/repo/b"]);
			expect(resolved(2)?.rootDirs).toEqual(["/repo/z"]);
		});

		it("should report nothing when the resolved value is unchanged", async () => {
			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			await start();

			await write("/repo/default.rogen.json", {
				rootDirs: ["a"],
			});
			const reload = await selection.reload(["/repo/default.rogen.json"]);

			expect(reload).toEqual({ changed: [], notices: [] });
		});

		it("should keep the last valid value when a reload breaks the config, and report the new errors", async () => {
			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			await start();

			await write(
				"/repo/default.rogen.json",
				`{
	"rootDirs": ["b"],
	"bogus": 1
}`
			);
			const reload = await selection.reload(["/repo/default.rogen.json"]);

			expect(resolved(0)?.rootDirs).toEqual(["/repo/a"]);
			expect(errors(0)).toMatchObject([
				{
					code: "config.unknownField",
					position: { line: 3, column: 2 },
				},
			]);
			expect(reload.changed).toEqual([]);
			expect(reload.notices).toEqual([
				{ file: "/repo/default.rogen.json", errors: errors(0) },
			]);
		});

		it("should report only the errors the previous load didn't have", async () => {
			await write("/repo/default.rogen.json", { bogus: 1 });
			await start();

			await write("/repo/default.rogen.json", { bogus: 1, other: 2 });
			const reload = await selection.reload(["/repo/default.rogen.json"]);

			expect(errors(0)).toHaveLength(2);
			expect(
				reload.notices.flatMap(({ errors }) =>
					errors.map(({ message }) => message)
				)
			).toEqual([expect.stringContaining('"other"')]);
		});

		it("should report nothing new when a broken config breaks the same way again", async () => {
			await write("/repo/default.rogen.json", { bogus: 1 });
			await start();

			await write("/repo/default.rogen.json", { bogus: 1 });
			const reload = await selection.reload(["/repo/default.rogen.json"]);

			expect(reload).toEqual({ changed: [], notices: [] });
		});

		it("should clear the errors and report a change once the file is fixed", async () => {
			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			await start();
			await write("/repo/default.rogen.json", { bogus: 1 });
			await selection.reload(["/repo/default.rogen.json"]);

			await write("/repo/default.rogen.json", { rootDirs: ["c"] });
			const reload = await selection.reload(["/repo/default.rogen.json"]);

			expect(errors(0)).toEqual([]);
			expect(resolved(0)?.rootDirs).toEqual(["/repo/c"]);
			expect(reload).toEqual({
				changed: ["/repo/default.rogen.json"],
				notices: [],
			});
		});

		it("should report a change when a config that was never valid becomes valid", async () => {
			await write("/repo/default.rogen.json", "{ nope");
			await start();

			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			const reload = await selection.reload(["/repo/default.rogen.json"]);

			expect(resolved(0)?.rootDirs).toEqual(["/repo/a"]);
			expect(reload.changed).toEqual(["/repo/default.rogen.json"]);
		});

		it("should ignore files no config reads", async () => {
			await write("/repo/default.rogen.json", {});
			await start();
			const [before] = selection.entries;

			await selection.reload(["/repo/unrelated.json"]);

			expect(selection.entries[0]).toBe(before);
		});

		it("should start watching the files a reload begins to read", async () => {
			await write("/repo/base.rogen.json", {});
			await write("/repo/default.rogen.json", {});
			await start();

			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
			});
			await selection.reload(["/repo/default.rogen.json"]);

			expect(selection.files).toEqual(
				new Set(["/repo/default.rogen.json", "/repo/base.rogen.json"])
			);
		});
	});

	describe("resolution", () => {
		const diagnosticsFor = async (
			config: Record<string, unknown> | string,
			file = "default"
		) => {
			await write(`/repo/${file}.rogen.json`, config);
			await start({ names: [file] });
			return errors(0).map((d) => [
				d.message,
				d.resource,
				d.position?.line,
				d.position?.column,
			]);
		};

		it("should apply a default only when the whole chain leaves the field out", async () => {
			await write("/repo/base.rogen.json", {
				exclude: ["**/*.spec.luau"],
				rootDirs: ["core"],
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
			});

			await start();

			expect(resolved(0)).toMatchObject({
				exclude: ["/repo/**/*.spec.luau"],
				rootDirs: ["/repo/core"],
				routes: {},
				variants: {},
			});
		});

		it("should not inject a route set when the chain declares no routes", async () => {
			await write("/repo/default.rogen.json", {});

			await start();

			expect(plain(resolved(0))?.routes).toEqual({});
		});

		it("should default outFile from the config's stem", async () => {
			await write("/repo/lobby.rogen.json", {});

			await start({ names: ["lobby"] });

			expect(resolved(0)?.outFile).toBe("/repo/lobby.project.json");
		});

		describe("project name", () => {
			it("should prefer the template's own name", async () => {
				await write("/repo/t.project.json", {
					name: "FromTemplate",
					tree: {},
				});
				await write("/repo/default.rogen.json", {
					template: "t.project.json",
				});

				await start();

				expect(resolved(0)?.name).toBe("FromTemplate");
			});

			it("should fall back to the config's directory when the template has no name", async () => {
				await write("/repo/t.project.json", { tree: {} });
				await write("/repo/default.rogen.json", {
					template: "t.project.json",
				});

				await start();

				expect(resolved(0)?.name).toBe("repo");
			});

			it("should fall back to the config's directory when there is no template", async () => {
				await write("/repo/default.rogen.json", {});

				await start();

				expect(resolved(0)?.name).toBe("repo");
			});

			it("should never be empty", async () => {
				fs = new MemoryFileSystemService();
				await write("/default.rogen.json", {});

				await start({}, "/");

				expect(resolved(0)?.name).toBe("project");
			});

			it("should ignore an empty template name", async () => {
				await write("/repo/t.project.json", { name: "", tree: {} });
				await write("/repo/default.rogen.json", {
					template: "t.project.json",
				});

				await start();

				expect(resolved(0)?.name).toBe("repo");
			});
		});

		describe("template", () => {
			it("should carry the parsed template and its file", async () => {
				await write("/repo/t.project.json", {
					name: "Game",
					tree: { $className: "DataModel" },
				});
				await write("/repo/default.rogen.json", {
					template: "t.project.json",
				});

				await start();

				expect(plain(resolved(0))?.template).toEqual({
					file: "/repo/t.project.json",
					project: {
						name: "Game",
						tree: { $className: "DataModel" },
					},
				});
				expect(selection.files).toContain("/repo/t.project.json");
			});

			it("should report a missing template at the field that named it", async () => {
				const problems = await diagnosticsFor(`{
	"template": "missing.project.json"
}`);

				expect(problems).toHaveLength(1);
				expect(problems[0][0]).toContain(
					"the template could not be read"
				);
				expect(problems[0].slice(1)).toEqual([
					"/repo/default.rogen.json",
					2,
					14,
				]);
				expect(selection.files).toContain("/repo/missing.project.json");
			});

			it("should report a template that is not a JSON object", async () => {
				await write("/repo/t.project.json", "[1]");

				const problems = await diagnosticsFor({
					template: "t.project.json",
				});

				expect(problems.map((p) => p[0])).toEqual([
					"the template is not a valid Rojo project file: it must be a JSON object.",
				]);
			});

			it("should report a template with invalid JSON", async () => {
				await write("/repo/t.project.json", "{ nope");

				const problems = await diagnosticsFor({
					template: "t.project.json",
				});

				expect(problems[0][0]).toContain(
					"the template is not a valid Rojo project file: invalid JSONC"
				);
			});

			it("should point at the parent file that named the template", async () => {
				await write(
					"/repo/base.rogen.json",
					`{
	"template": "missing.project.json"
}`
				);

				const problems = await diagnosticsFor({
					extends: "./base.rogen.json",
				});

				expect(problems[0].slice(1)).toEqual([
					"/repo/base.rogen.json",
					2,
					14,
				]);
			});

			it("should report a change when the template's contents change", async () => {
				await write("/repo/t.project.json", { name: "One", tree: {} });
				await write("/repo/default.rogen.json", {
					template: "t.project.json",
				});
				await start();

				await write("/repo/t.project.json", { name: "Two", tree: {} });
				const reload = await selection.reload(["/repo/t.project.json"]);

				expect(resolved(0)?.name).toBe("Two");
				expect(reload.changed).toEqual(["/repo/default.rogen.json"]);
			});
		});

		describe("validation", () => {
			it("should reject a route key with a separator", async () => {
				const problems = await diagnosticsFor(`{
	"routes": {
		"my-key": "ServerScriptService"
	}
}`);

				expect(problems).toEqual([
					[
						'route key "my-key" is invalid: use letters and digits only, starting with a letter.',
						"/repo/default.rogen.json",
						3,
						13,
					],
				]);
			});

			it("should accept the fallback route key", async () => {
				expect(
					await diagnosticsFor({
						routes: { "*": "ReplicatedStorage" },
					})
				).toEqual([]);
			});

			it("should reject a variant name that starts with a digit", async () => {
				const problems = await diagnosticsFor(`{
	"variants": { "1st": true }
}`);

				expect(problems).toEqual([
					[
						'variant "1st" is invalid: use letters and digits only, starting with a letter.',
						"/repo/default.rogen.json",
						2,
						23,
					],
				]);
			});

			it("should reject a variant that shares a name with a route key", async () => {
				const problems = await diagnosticsFor(`{
	"routes": { "server": "ServerScriptService" },
	"variants": { "server": true }
}`);

				expect(problems).toEqual([
					[
						'variant "server" has the same name as a route key; rename one of them.',
						"/repo/default.rogen.json",
						3,
						26,
					],
				]);
			});

			it("should reject two route keys that differ only in the case of their first letter", async () => {
				const problems = await diagnosticsFor(`{
	"routes": { "server": "ServerScriptService", "Server": "Workspace" }
}`);

				expect(problems).toEqual([
					[
						'"Server" and "server" differ only in the case of their first letter, so both would match the same names; keep one of them.',
						"/repo/default.rogen.json",
						2,
						57,
					],
				]);
			});

			it("should reject two variants that differ only in the case of their first letter", async () => {
				const problems = await diagnosticsFor(`{
	"variants": { "mock": true, "Mock": false }
}`);

				expect(problems).toHaveLength(1);
				expect(problems[0][0]).toContain('"Mock" and "mock"');
			});

			it("should reject a variant that differs from a route key only in the case of its first letter", async () => {
				const problems = await diagnosticsFor(`{
	"routes": { "server": "ServerScriptService" },
	"variants": { "Server": true }
}`);

				expect(problems).toHaveLength(1);
				expect(problems[0][0]).toContain('"Server" and "server"');
			});

			it("should accept keys that differ beyond the first letter", async () => {
				expect(
					await diagnosticsFor({
						routes: { server: "ServerScriptService" },
						variants: { SERVER: true },
					})
				).toEqual([]);
			});

			it("should reject a route target whose service is unsupported", async () => {
				const problems = await diagnosticsFor(`{
	"routes": { "server": "Nowhere/Folder" }
}`);

				expect(problems).toHaveLength(1);
				expect(problems[0][0]).toContain(
					'"Nowhere" is not a supported service'
				);
				expect(problems[0].slice(1)).toEqual([
					"/repo/default.rogen.json",
					2,
					24,
				]);
			});

			it("should point at the parent that supplied a bad route", async () => {
				await write(
					"/repo/base.rogen.json",
					`{
	"routes": { "server": "Nowhere" }
}`
				);

				const problems = await diagnosticsFor({
					extends: "./base.rogen.json",
					routes: { client: "StarterGui" },
				});

				expect(problems.map((p) => p.slice(1))).toEqual([
					["/repo/base.rogen.json", 2, 24],
				]);
			});

			it("should reject writing over its own template", async () => {
				await write("/repo/game.project.json", { tree: {} });

				const problems = await diagnosticsFor(`{
	"template": "game.project.json",
	"outFile": "game.project.json"
}`);

				expect(problems).toEqual([
					[
						'the output file /repo/game.project.json is also the template, and a build would overwrite it. Set "outFile" to another path.',
						"/repo/default.rogen.json",
						3,
						13,
					],
				]);
			});

			it("should reject a default outFile that is the template", async () => {
				await write("/repo/default.project.json", { tree: {} });

				const problems = await diagnosticsFor(`{
	"template": "default.project.json"
}`);

				expect(problems.map((p) => p[0])).toEqual([
					'the output file /repo/default.project.json is also the template, and a build would overwrite it. Set "outFile" to another path.',
				]);
				expect(problems[0].slice(1)).toEqual([
					"/repo/default.rogen.json",
					2,
					14,
				]);
			});

			it("should reject a root dir inside another, naming both", async () => {
				const problems = await diagnosticsFor(`{
	"rootDirs": ["src", "src/shared"]
}`);

				expect(problems).toEqual([
					[
						'root dir "/repo/src/shared" is inside root dir "/repo/src"; a file under it would belong to both. Remove one.',
						"/repo/default.rogen.json",
						2,
						22,
					],
				]);
			});

			it("should reject a root dir listed twice, at the repeat", async () => {
				const problems = await diagnosticsFor(`{
	"rootDirs": ["src", "./src"]
}`);

				expect(problems).toEqual([
					[
						'root dir "/repo/src" is listed twice; a file under it would belong to both. Remove one.',
						"/repo/default.rogen.json",
						2,
						22,
					],
				]);
			});

			it("should catch the nesting whichever order the root dirs come in", async () => {
				const problems = await diagnosticsFor({
					rootDirs: ["src/shared", "src"],
				});

				expect(problems).toHaveLength(1);
				expect(problems[0][0]).toContain(
					'root dir "/repo/src/shared" is inside root dir "/repo/src"'
				);
			});

			it("should accept root dirs that are only siblings or share a prefix", async () => {
				expect(
					await diagnosticsFor({
						rootDirs: ["core", "places/lobby", "core-extra"],
					})
				).toEqual([]);
			});

			it("should report every problem at once", async () => {
				const problems = await diagnosticsFor({
					routes: { "a-b": "Nowhere" },
					variants: { "c-d": true },
					rootDirs: ["src", "src/x"],
				});

				expect(problems).toHaveLength(4);
			});

			it("should keep the last valid config when a reload turns a rule bad", async () => {
				await write("/repo/default.rogen.json", { rootDirs: ["a"] });
				await start();

				await write("/repo/default.rogen.json", {
					rootDirs: ["a", "a/b"],
				});
				await selection.reload(["/repo/default.rogen.json"]);

				expect(resolved(0)?.rootDirs).toEqual(["/repo/a"]);
				expect(errors(0)).toHaveLength(1);
			});
		});

		it("should read neither the working directory nor the clock", async () => {
			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			const cwd = jest.spyOn(process, "cwd");
			const now = jest.spyOn(Date, "now");

			await start();

			expect(cwd).not.toHaveBeenCalled();
			expect(now).not.toHaveBeenCalled();
			jest.restoreAllMocks();
		});
	});

	describe("overrides", () => {
		it("should apply outFile, syncDir and template against the working directory", async () => {
			await write("/repo/base.project.json", { name: "Base" });
			await write("/repo/default.rogen.json", {
				outFile: "old.project.json",
				syncDir: "old",
			});

			await start({
				overrides: {
					outFile: "out/new.project.json",
					syncDir: "dist",
					template: "base.project.json",
					variants: {},
				},
			});

			expect(resolved(0)).toMatchObject({
				outFile: "/repo/out/new.project.json",
				syncDir: "/repo/dist",
				template: { file: "/repo/base.project.json" },
			});
		});

		it("should turn a declared variant on or off and leave the others", async () => {
			await write("/repo/default.rogen.json", {
				variants: { mock: false, dev: true, prod: false },
			});

			await start({
				overrides: { variants: { mock: true, dev: false } },
			});

			expect(resolved(0)?.variants).toEqual({
				mock: true,
				dev: false,
				prod: false,
			});
		});

		it("should fail when no named config declares the variant", async () => {
			await write("/repo/lobby.rogen.json", {
				variants: { mock: false },
			});
			await write("/repo/match.rogen.json", {});

			const result = await start({
				names: ["lobby", "match"],
				overrides: { variants: { ghost: true } },
			});

			expect((result as ResultError<Error>).error.message).toContain(
				'"ghost"'
			);
		});

		it("should suggest the declared variant a misspelled one is closest to", async () => {
			await write("/repo/default.rogen.json", {
				variants: { mock: false },
			});

			const result = await start({
				overrides: { variants: { mokc: true } },
			});

			expect((result as ResultError<Error>).error.message).toBe(
				'Variant "mokc" is not declared by any config being built. Did you mean "mock"?'
			);
		});

		it("should apply a variant where it is declared and say where it was skipped", async () => {
			await write("/repo/lobby.rogen.json", {
				variants: { mock: false },
			});
			await write("/repo/match.rogen.json", {});

			const result = await start({
				names: ["lobby", "match"],
				overrides: { variants: { mock: true } },
			});

			expect(result.isOk()).toBe(true);
			expect(
				selection.entries.map((c) => buildableConfig(c)?.variants)
			).toEqual([{ mock: true }, {}]);
			expect(
				selection.entries.map(
					(c) => buildableConfig(c)?.skippedVariants
				)
			).toEqual([[], ["mock"]]);
		});

		it("should keep the skipped variants of the last valid config when a reload breaks it", async () => {
			await write("/repo/lobby.rogen.json", {
				variants: { mock: false },
			});
			await write("/repo/match.rogen.json", {});
			await start({
				names: ["lobby", "match"],
				overrides: { variants: { mock: true } },
			});

			await write("/repo/match.rogen.json", "{ nope");
			await selection.reload(["/repo/match.rogen.json"]);

			expect(resolved(1)?.skippedVariants).toEqual(["mock"]);
		});

		it("should not fail on a variant when a named config could not be read", async () => {
			await write("/repo/lobby.rogen.json", "{ nope");

			const result = await start({
				names: ["lobby"],
				overrides: { variants: { mock: true } },
			});

			expect(result.isOk()).toBe(true);
		});

		it("should keep the overrides across a reload", async () => {
			await write("/repo/default.rogen.json", {
				rootDirs: ["a"],
				variants: { mock: false },
			});
			await start({
				overrides: {
					outFile: "out.project.json",
					variants: { mock: true },
				},
			});

			await write("/repo/default.rogen.json", {
				rootDirs: ["b"],
				variants: { mock: false },
			});
			await selection.reload(["/repo/default.rogen.json"]);

			expect(resolved(0)).toMatchObject({
				rootDirs: ["/repo/b"],
				outFile: "/repo/out.project.json",
				variants: { mock: true },
			});
		});
	});
});
