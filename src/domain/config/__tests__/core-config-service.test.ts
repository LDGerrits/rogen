import { jest } from "@jest/globals";
import { UsageError } from "../../../base/errors.js";
import { ResultError } from "../../../base/result.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfig } from "../config.js";
import { ConfigSelection, buildableConfig } from "../config-service.js";
import { CoreConfigService } from "../core-config-service.js";

interface Refs {
	/** Names or paths; the default config when absent. */
	readonly names?: string[];
	readonly overrides?: {
		readonly outFile?: string;
		readonly mode?: string;
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
		{ names = ["default"], overrides }: Refs = {},
		cwd = "/repo"
	) => {
		const variants = Object.entries(overrides?.variants ?? {});
		service = new CoreConfigService(fs, new MockEnvironmentService(cwd));
		const result = await service.select(names, {
			"out-file": overrides?.outFile,
			mode: overrides?.mode,
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
			new MockEnvironmentService("/repo")
		);
	});

	describe("select", () => {
		it("should select every config here when none is named, sorted", async () => {
			await write("/repo/match.rogen.json", {});
			await write("/repo/lobby.rogen.json", {});
			await fs.writeFile("/repo/README.md", "");
			await fs.createDirectory("/repo/dir.rogen.json");
			await write("/repo/nested/other.rogen.json", {});

			const selection = (await start({ names: [] })).unwrap();

			expect(selection.entries.map(({ file }) => file)).toEqual([
				"/repo/lobby.rogen.json",
				"/repo/match.rogen.json",
			]);
		});

		it("should select only the configs named, by name or path", async () => {
			await write("/repo/default.rogen.json", {});
			await write("/repo/places/lobby.rogen.json", {});

			const selection = (
				await start({ names: ["places/lobby.rogen.json"] })
			).unwrap();

			expect(selection.entries.map(({ file }) => file)).toEqual([
				"/repo/places/lobby.rogen.json",
			]);
		});

		const refusal = async (refs: Refs) => {
			await write("/repo/lobby.rogen.json", {});
			await write("/repo/match.rogen.json", {});
			const result = await start(refs);
			return result.isErr() ? result.error : undefined;
		};

		it("should refuse -o with several named configs", async () => {
			const error = await refusal({
				names: ["lobby", "match.rogen.json"],
				overrides: { outFile: "a.json", variants: {} },
			});

			expect(error).toBeInstanceOf(UsageError);
			expect(error?.message).toBe(
				"-o targets a single config, but 2 configs were named. Name one config, or set outFile in the file."
			);
		});

		it("should refuse -o when none is named and several are here", async () => {
			const error = await refusal({
				names: [],
				overrides: { outFile: "a.json", variants: {} },
			});

			expect(error?.message).toBe(
				"-o targets a single config, but 2 configs are here. Name one config, or set outFile in the file."
			);
		});

		it("should allow -o with one config", async () => {
			await write("/repo/lobby.rogen.json", {});

			const result = await start({
				names: ["lobby"],
				overrides: { outFile: "a.json", variants: {} },
			});

			expect(result.isOk()).toBe(true);
		});

		it("should allow -o when none is named and one is here", async () => {
			await write("/repo/lobby.rogen.json", {});

			const result = await start({
				names: [],
				overrides: { outFile: "a.json", variants: {} },
			});

			expect(result.isOk()).toBe(true);
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
		});

		it("should fail with the errors of every broken config", async () => {
			await write("/repo/a.rogen.json", {});
			await write("/repo/b.rogen.json", { bogus: 1 });
			await write("/repo/c.rogen.json", "{ nope");
			await start({ names: ["a", "b", "c"] });

			const result = selection.requireValid();

			expect(
				(result as ResultError<DiagnosticsError>).error.diagnostics
			).toEqual([...errors(1), ...errors(2)]);
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

			expect(
				entry.status === "broken" &&
					entry.errors.map(({ code }) => code)
			).toEqual(["config.unknownField", "test.hint"]);
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
				variants: ["mock", "debug"],
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
				routes: {
					"*": "ReplicatedStorage/shared",
					client: "StarterGui",
				},
				variants: ["fake"],
			});

			await start();

			expect(plain(resolved(0))).toMatchObject({
				routes: {
					server: "ServerScriptService",
					"*": "ReplicatedStorage/shared",
					client: "StarterGui",
				},
				variants: { mock: false, debug: false, fake: false },
			});
		});

		it("should add a child's variants, conflicts and a mode's variants to its parent's", async () => {
			await write("/repo/base.rogen.json", {
				variants: ["mock", "halloween"],
				conflicts: [["halloween", "christmas"]],
				mode: "dev",
				modes: { dev: { variants: ["mock"] } },
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
				variants: ["christmas", "debug"],
				conflicts: [["debug", "halloween"]],
				modes: { dev: { variants: ["debug"] } },
			});

			await start();

			expect(resolved(0)).toMatchObject({
				variants: {
					mock: true,
					halloween: false,
					christmas: false,
					debug: true,
				},
				conflicts: [
					["halloween", "christmas"],
					["debug", "halloween"],
				],
			});
		});

		it("should add a child's list entries to its parent's", async () => {
			await write("/repo/base.rogen.json", {
				rootDirs: ["core"],
				exclude: ["**/*.spec.luau"],
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
				rootDirs: ["places/lobby"],
				exclude: ["**/*.story.luau"],
			});

			await start();

			expect(resolved(0)).toMatchObject({
				rootDirs: ["/repo/core", "/repo/places/lobby"],
				exclude: ["/repo/**/*.spec.luau", "/repo/**/*.story.luau"],
			});
		});

		it("should add list entries across a chain of three", async () => {
			await write("/repo/core.rogen.json", { exclude: ["a"] });
			await write("/repo/middle.rogen.json", {
				extends: "./core.rogen.json",
				exclude: ["b"],
			});
			await write("/repo/default.rogen.json", {
				extends: "./middle.rogen.json",
				exclude: ["c"],
			});

			await start();

			expect(resolved(0)?.exclude).toEqual([
				"/repo/a",
				"/repo/b",
				"/repo/c",
			]);
		});

		it("should keep a repeated entry at its last position", async () => {
			await write("/repo/base.rogen.json", {
				rootDirs: ["core", "shared"],
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
				rootDirs: ["core", "places/lobby"],
			});

			await start();

			expect(resolved(0)?.rootDirs).toEqual([
				"/repo/shared",
				"/repo/core",
				"/repo/places/lobby",
			]);
		});

		it("should apply the default list only when no config in the chain sets it", async () => {
			await write("/repo/base.rogen.json", { routes: {} });
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
			});
			await write("/repo/lobby.rogen.json", {
				extends: "./base.rogen.json",
				rootDirs: ["places/lobby"],
			});

			await start({ names: ["default", "lobby"] });

			expect(resolved(0)?.rootDirs).toEqual(["/repo/src"]);
			expect(resolved(1)?.rootDirs).toEqual(["/repo/places/lobby"]);
		});

		it("should point a root dir diagnostic at the file and position that wrote the entry", async () => {
			await write(
				"/repo/base.rogen.json",
				`{
	"rootDirs": ["src/Lib"]
}`
			);
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
				rootDirs: ["src"],
			});

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.nestedRootDir",
					resource: "/repo/base.rogen.json",
					position: { line: 2, column: 15 },
				},
			]);
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

			await start({ names: ["places/default.rogen.json"] });

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
				variants: ["mock"],
			});
			await write("/repo/lobby-source.rogen.json", {
				extends: "./core.rogen.json",
				rootDirs: ["core", "places/lobby"],
				routes: { client: "StarterPlayer/StarterPlayerScripts" },
			});
			await write("/repo/lobby.rogen.json", {
				extends: "./lobby-source.rogen.json",
				syncDir: "dist/lobby",
				variants: ["debug"],
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
				variants: { mock: false, debug: false },
				exclude: [],
				syncDir: "/repo/dist/lobby",
				outFile: "/repo/lobby.project.json",
			});
		});

		it("should read each config once to find it and once to load it", async () => {
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
				new MockEnvironmentService("/repo")
			);
			await write("/repo/core.rogen.json", { rootDirs: ["core"] });
			await write("/repo/default.rogen.json", {
				extends: "./core.rogen.json",
			});

			await start();

			expect(reads.sort()).toEqual([
				"/repo/core.rogen.json",
				"/repo/core.rogen.json",
				"/repo/default.rogen.json",
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

		it("should report a config cut off inside a nested object once", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"routes": { "*": "ReplicatedStorage"`
			);

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.invalidSyntax",
					message: "invalid JSONC: expected '}'.",
					position: { line: 2, column: 38 },
				},
			]);
		});

		it("should say a missing extends target does not exist, where it looked, and that paths are relative to the config", async () => {
			await write("/repo/default.rogen.json", {
				extends: "./missing.rogen.json",
			});

			await start();

			expect(errors(0)[0].message).toBe(
				'"extends" target "./missing.rogen.json" does not exist (looked for /repo/missing.rogen.json). Paths are relative to this config.'
			);
		});

		it("should give the reason for an extends target that is a directory", async () => {
			await fs.createDirectory("/repo/dir.rogen.json");
			await write("/repo/default.rogen.json", {
				extends: "./dir.rogen.json",
			});

			await start();

			expect(errors(0)[0].message).toBe(
				'"extends" target "./dir.rogen.json" could not be read: illegal operation on a directory.'
			);
		});

		it("should give the reason for a template that is a directory", async () => {
			await fs.createDirectory("/repo/t.project.json");
			await write("/repo/default.rogen.json", {
				template: "t.project.json",
			});

			await start();

			expect(errors(0)[0].message).toBe(
				"the template could not be read: illegal operation on a directory."
			);
		});

		it("should never print a Node error code in a message about a file it could not read", async () => {
			await fs.createDirectory("/repo/dir.rogen.json");
			await fs.createDirectory("/repo/t.project.json");
			const cases: Record<string, unknown>[] = [
				{ extends: "./missing.rogen.json" },
				{ extends: "./dir.rogen.json" },
				{ template: "missing.project.json" },
				{ template: "t.project.json" },
			];

			for (const config of cases) {
				await write("/repo/default.rogen.json", config);
				await start();
				expect(errors(0)[0].message).not.toMatch(
					/\b(ENOENT|EISDIR|EACCES|ENOTDIR|ELOOP)\b/
				);
			}
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
				variants: [null],
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
					'"variants[0]": expected a string, found null.',
				],
			]);
		});

		it("should keep a trailing slash on an excluded directory", async () => {
			await write("/repo/default.rogen.json", { exclude: ["dist/"] });

			await start();

			expect(resolved(0)?.exclude).toEqual(["/repo/dist/"]);
		});
	});

	describe("reload of every config here", () => {
		beforeEach(async () => {
			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
		});

		it("should know the folder it was picked from, and not when configs were named", async () => {
			await start({ names: [] });
			expect(selection.directory).toBe("/repo");

			await start({ names: ["default"] });
			expect(selection.directory).toBeUndefined();
		});

		it("should concern the config files of that folder and the files it reads", async () => {
			await start({ names: [] });

			expect(selection.concerns("/repo/new.rogen.json")).toBe(true);
			expect(selection.concerns("/repo/default.rogen.json")).toBe(true);
			expect(selection.concerns("/repo/src/x.rogen.json")).toBe(false);
			expect(selection.concerns("/repo/README.md")).toBe(false);
		});

		it("should pick up a config added to the folder, and report it", async () => {
			await start({ names: [] });

			await write("/repo/lobby.rogen.json", { rootDirs: ["b"] });
			const reload = await selection.reload(["/repo/lobby.rogen.json"]);

			expect(selection.entries.map(({ file }) => file)).toEqual([
				"/repo/default.rogen.json",
				"/repo/lobby.rogen.json",
			]);
			expect(reload.changed).toEqual(["/repo/lobby.rogen.json"]);
			expect(reload.notices).toEqual([
				{ kind: "added", file: "/repo/lobby.rogen.json" },
			]);
			expect(selection.files.has("/repo/lobby.rogen.json")).toBe(true);
		});

		it("should report a config added broken with its errors, which no earlier version stands in for", async () => {
			await start({ names: [] });

			await write("/repo/lobby.rogen.json", { bogus: 1 });
			const reload = await selection.reload(["/repo/lobby.rogen.json"]);

			expect(selection.entries[1].status).toBe("broken");
			expect(reload.changed).toEqual([]);
			expect(reload.notices).toMatchObject([
				{
					kind: "broken",
					file: "/repo/lobby.rogen.json",
					keptLastValid: false,
				},
			]);
		});

		it("should drop a config deleted from the folder, and report it", async () => {
			await write("/repo/lobby.rogen.json", {});
			await start({ names: [] });

			await fs.delete("/repo/lobby.rogen.json");
			const reload = await selection.reload(["/repo/lobby.rogen.json"]);

			expect(selection.entries.map(({ file }) => file)).toEqual([
				"/repo/default.rogen.json",
			]);
			expect(reload.notices).toEqual([
				{ kind: "removed", file: "/repo/lobby.rogen.json" },
			]);
			expect(selection.files.has("/repo/lobby.rogen.json")).toBe(false);
		});

		it("should concern configs and folders in the folders below it", async () => {
			await fs.createDirectory("/repo/places");
			await start({ names: [] });

			expect(selection.concerns("/repo/places/lobby.rogen.json")).toBe(
				true
			);
			expect(selection.concerns("/repo/places/lobby", true)).toBe(true);
			expect(selection.concerns("/repo/places/lobby")).toBe(false);
			expect(selection.concerns("/repo/places/README.md")).toBe(false);
		});

		it("should pick up a config added in a new folder below that extends one here", async () => {
			await start({ names: [] });

			await write("/repo/places/lobby/lobby.rogen.json", {
				extends: "../../default.rogen.json",
			});
			const reload = await selection.reload(["/repo/places"]);

			expect(selection.entries.map(({ file }) => file)).toEqual([
				"/repo/default.rogen.json",
				"/repo/places/lobby/lobby.rogen.json",
			]);
			expect(reload.notices).toEqual([
				{ kind: "added", file: "/repo/places/lobby/lobby.rogen.json" },
			]);
			expect(selection.folders).toContain("/repo/places/lobby");
		});

		it("should leave a config below that extends nothing here, until it does", async () => {
			await write("/repo/places/lobby/lobby.rogen.json", {});
			await start({ names: [] });

			expect(selection.entries).toHaveLength(1);
			expect(selection.separate).toEqual([
				"/repo/places/lobby/lobby.rogen.json",
			]);

			await write("/repo/places/lobby/lobby.rogen.json", {
				extends: "../../default.rogen.json",
			});
			await selection.reload(["/repo/places/lobby/lobby.rogen.json"]);

			expect(selection.entries).toHaveLength(2);
			expect(selection.separate).toEqual([]);
		});

		it("should be left with no config when the last one is deleted", async () => {
			await start({ names: [] });

			await fs.delete("/repo/default.rogen.json");
			await selection.reload(["/repo/default.rogen.json"]);

			expect(selection.entries).toEqual([]);
		});

		it("should not look for new configs when the selection named its configs", async () => {
			await start({ names: ["default"] });

			await write("/repo/lobby.rogen.json", {});
			const reload = await selection.reload(["/repo/lobby.rogen.json"]);

			expect(selection.entries).toHaveLength(1);
			expect(reload).toEqual({ changed: [], notices: [] });
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

		it("should keep the same config when a reload loads it unchanged, even after it broke", async () => {
			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			await start();
			const before = resolved(0);

			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			await selection.reload(["/repo/default.rogen.json"]);
			expect(resolved(0)).toBe(before);

			await fs.writeFile("/repo/default.rogen.json", "{ nope");
			await selection.reload(["/repo/default.rogen.json"]);
			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			await selection.reload(["/repo/default.rogen.json"]);
			expect(resolved(0)).toBe(before);
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
				{
					kind: "broken",
					file: "/repo/default.rogen.json",
					errors: errors(0),
					keptLastValid: true,
				},
			]);
		});

		it("should report only the errors the previous load didn't have", async () => {
			await write("/repo/default.rogen.json", { bogus: 1 });
			await start();

			await write("/repo/default.rogen.json", { bogus: 1, other: 2 });
			const reload = await selection.reload(["/repo/default.rogen.json"]);

			expect(errors(0)).toHaveLength(2);
			expect(
				reload.notices.flatMap((notice) =>
					notice.kind === "broken"
						? notice.errors.map(({ message }) => message)
						: []
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

		it("should clear the errors, report a change and say it loads again once the file is fixed", async () => {
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
				notices: [
					{ kind: "recovered", file: "/repo/default.rogen.json" },
				],
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
				expect(problems[0][0]).toBe(
					"the template does not exist (looked for /repo/missing.project.json). Paths are relative to the config that sets them."
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

			it("should merge a child's template over its parent's, rebasing the parent's paths", async () => {
				await write("/repo/places/shared/template.project.json", {
					name: "Game",
					servePort: 34872,
					globIgnorePaths: ["**/*.spec.luau"],
					tree: {
						$className: "DataModel",
						ReplicatedStorage: {
							Packages: { $path: "../../Packages" },
						},
					},
				});
				await write("/repo/places/lobby/template.project.json", {
					name: "Lobby",
					servePort: 34873,
				});
				await write("/repo/default.rogen.json", {
					template: "places/shared/template.project.json",
				});
				await write("/repo/lobby.rogen.json", {
					extends: "./default.rogen.json",
					template: "places/lobby/template.project.json",
				});

				await start({ names: ["lobby"] });

				expect(resolved(0)?.name).toBe("Lobby");
				expect(plain(resolved(0))?.template).toEqual({
					file: "/repo/places/lobby/template.project.json",
					project: {
						name: "Lobby",
						servePort: 34873,
						globIgnorePaths: ["../shared/**/*.spec.luau"],
						tree: {
							$className: "DataModel",
							ReplicatedStorage: {
								Packages: { $path: "../../Packages" },
							},
						},
					},
				});
				expect(resolved(0)?.template?.bases).toEqual([
					"/repo/places/shared/template.project.json",
				]);
				expect([...selection.files]).toEqual(
					expect.arrayContaining([
						"/repo/places/shared/template.project.json",
						"/repo/places/lobby/template.project.json",
					])
				);
			});

			it("should merge every template down a chain, the nearest last", async () => {
				await write("/repo/a.template.json", {
					name: "A",
					tree: { Lighting: { $properties: { Brightness: 1 } } },
				});
				await write("/repo/b.template.json", {
					tree: { Workspace: { $properties: { Gravity: 100 } } },
				});
				await write("/repo/c.template.json", { name: "C" });
				await write("/repo/a.rogen.json", {
					template: "a.template.json",
				});
				await write("/repo/b.rogen.json", {
					extends: "./a.rogen.json",
					template: "b.template.json",
				});
				await write("/repo/c.rogen.json", {
					extends: "./b.rogen.json",
					template: "c.template.json",
				});

				await start({ names: ["c"] });

				expect(resolved(0)?.template?.project.getTree()).toEqual({
					name: "C",
					tree: {
						$className: "DataModel",
						Lighting: { $properties: { Brightness: 1 } },
						Workspace: { $properties: { Gravity: 100 } },
					},
				});
				expect(resolved(0)?.template?.bases).toEqual([
					"/repo/a.template.json",
					"/repo/b.template.json",
				]);
			});

			it("should merge a template a child names again over the ones between", async () => {
				await write("/repo/t.template.json", { name: "T" });
				await write("/repo/m.template.json", { name: "M" });
				await write("/repo/root.rogen.json", {
					template: "t.template.json",
				});
				await write("/repo/mid.rogen.json", {
					extends: "./root.rogen.json",
					template: "m.template.json",
				});
				await write("/repo/default.rogen.json", {
					extends: "./mid.rogen.json",
					template: "t.template.json",
				});

				await start();

				expect(resolved(0)?.name).toBe("T");
				expect(resolved(0)?.template?.bases).toEqual([
					"/repo/m.template.json",
				]);
			});

			it("should name the template that set a field it lost to, down a chain", async () => {
				await write("/repo/a.template.json", {
					tree: { Lighting: { $properties: { Brightness: 1 } } },
				});
				await write("/repo/b.template.json", {
					tree: { Lighting: { $properties: { Brightness: 2 } } },
				});
				await write("/repo/c.template.json", { name: "C" });
				await write("/repo/a.rogen.json", {
					template: "a.template.json",
				});
				await write("/repo/b.rogen.json", {
					extends: "./a.rogen.json",
					template: "b.template.json",
				});
				await write("/repo/c.rogen.json", {
					extends: "./b.rogen.json",
					template: "c.template.json",
				});

				await start({ names: ["c"] });

				expect(resolved(0)?.template?.clashes).toEqual([
					{
						instancePath: ["Lighting"],
						field: "$properties.Brightness",
						file: "/repo/b.template.json",
						base: "/repo/a.template.json",
					},
				]);
			});

			it("should read a template a child names again only once", async () => {
				await write("/repo/t.project.json", { name: "Game", tree: {} });
				await write("/repo/base.rogen.json", {
					template: "t.project.json",
				});
				await write("/repo/default.rogen.json", {
					extends: "./base.rogen.json",
					template: "t.project.json",
				});

				await start();

				expect(resolved(0)?.template?.bases).toEqual([]);
				expect(resolved(0)?.template?.clashes).toEqual([]);
			});

			it("should carry what the child's template overrode in its parent's", async () => {
				await write("/repo/base.project.json", {
					name: "Game",
					tree: {
						ReplicatedStorage: { Packages: { $path: "Packages" } },
					},
				});
				await write("/repo/lobby.project.json", {
					tree: {
						ReplicatedStorage: { Packages: { $path: "vendor" } },
					},
				});
				await write("/repo/default.rogen.json", {
					template: "base.project.json",
				});
				await write("/repo/lobby.rogen.json", {
					extends: "./default.rogen.json",
					template: "lobby.project.json",
					outFile: "out/lobby.project.json",
				});

				await start({ names: ["lobby"] });

				expect(resolved(0)?.template?.clashes).toEqual([
					{
						instancePath: ["ReplicatedStorage", "Packages"],
						field: "$path",
						file: "/repo/lobby.project.json",
						base: "/repo/base.project.json",
					},
				]);
			});

			it("should report a parent's broken template even when the child names its own", async () => {
				await write("/repo/lobby.project.json", { name: "Lobby" });
				await write(
					"/repo/base.rogen.json",
					`{
	"template": "missing.project.json"
}`
				);

				const problems = await diagnosticsFor({
					extends: "./base.rogen.json",
					template: "lobby.project.json",
				});

				expect(problems.map((problem) => problem.slice(1))).toEqual([
					["/repo/base.rogen.json", 2, 14],
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
	"variants": ["1st"]
}`);

				expect(problems).toEqual([
					[
						'variant "1st" is invalid: use letters and digits only, starting with a letter.',
						"/repo/default.rogen.json",
						2,
						15,
					],
				]);
			});

			it("should reject a variant that shares a name with a route key", async () => {
				const problems = await diagnosticsFor(`{
	"routes": { "server": "ServerScriptService" },
	"variants": ["server"]
}`);

				expect(problems).toEqual([
					[
						'variant "server" has the same name as a route key; rename one of them.',
						"/repo/default.rogen.json",
						3,
						15,
					],
				]);
			});

			it("should accept a variant named like a property every object has", async () => {
				const problems = await diagnosticsFor(`{
	"routes": { "server": "ServerScriptService" },
	"variants": ["constructor"]
}`);

				expect(problems).toEqual([]);
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
	"variants": ["mock", "Mock"]
}`);

				expect(problems).toHaveLength(1);
				expect(problems[0][0]).toContain('"Mock" and "mock"');
			});

			it("should reject a variant that differs from a route key only in the case of its first letter", async () => {
				const problems = await diagnosticsFor(`{
	"routes": { "server": "ServerScriptService" },
	"variants": ["Server"]
}`);

				expect(problems).toHaveLength(1);
				expect(problems[0][0]).toContain('"Server" and "server"');
			});

			it("should accept keys that differ beyond the first letter", async () => {
				expect(
					await diagnosticsFor({
						routes: { server: "ServerScriptService" },
						variants: ["SERVER"],
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

			it("should reject a default outFile that is a parent's template", async () => {
				await write("/repo/lobby.project.json", { tree: {} });
				await write("/repo/lobby.template.json", { name: "Lobby" });
				await write(
					"/repo/base.rogen.json",
					`{
	"template": "lobby.project.json"
}`
				);

				const problems = await diagnosticsFor(
					{
						extends: "./base.rogen.json",
						template: "lobby.template.json",
					},
					"lobby"
				);

				expect(problems).toEqual([
					[
						'the output file /repo/lobby.project.json is also the template, and a build would overwrite it. Set "outFile" to another path.',
						"/repo/base.rogen.json",
						2,
						14,
					],
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
					variants: ["c-d"],
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
		it("should apply outFile against the working directory", async () => {
			await write("/repo/default.rogen.json", {
				outFile: "old.project.json",
			});

			await start({
				overrides: { outFile: "out/new.project.json", variants: {} },
			});

			expect(resolved(0)).toMatchObject({
				outFile: "/repo/out/new.project.json",
			});
		});

		it("should leave every declared variant off unless a flag turns it on", async () => {
			await write("/repo/default.rogen.json", {
				variants: ["mock", "dev", "prod"],
			});

			await start();

			expect(resolved(0)?.variants).toEqual({
				mock: false,
				dev: false,
				prod: false,
			});
		});

		it("should turn a declared variant on and leave the others", async () => {
			await write("/repo/default.rogen.json", {
				variants: ["mock", "dev", "prod"],
			});

			await start({ overrides: { variants: { mock: true } } });

			expect(resolved(0)?.variants).toEqual({
				mock: true,
				dev: false,
				prod: false,
			});
		});

		it("should fail when no named config declares the variant", async () => {
			await write("/repo/lobby.rogen.json", { variants: ["mock"] });
			await write("/repo/match.rogen.json", {});

			const result = await start({
				names: ["lobby", "match"],
				overrides: { variants: { ghost: true } },
			});

			expect((result as ResultError<Error>).error.message).toContain(
				'"ghost"'
			);
		});

		it("should fail when no named config declares the variant a flag turns off", async () => {
			await write("/repo/default.rogen.json", { variants: ["mock"] });

			const result = await start({
				overrides: { variants: { ghost: false } },
			});

			expect(result.isErr() && result.error).toBeInstanceOf(UsageError);
		});

		it("should suggest the declared variant a misspelled one is closest to", async () => {
			await write("/repo/default.rogen.json", { variants: ["mock"] });

			const result = await start({
				overrides: { variants: { mokc: true } },
			});

			expect((result as ResultError<Error>).error.message).toBe(
				'Variant "mokc" is not declared by any config being built. Did you mean "mock"?'
			);
		});

		it("should apply a variant where it is declared and say where it was skipped", async () => {
			await write("/repo/lobby.rogen.json", { variants: ["mock"] });
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
			await write("/repo/lobby.rogen.json", { variants: ["mock"] });
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
				variants: ["mock"],
			});
			await start({
				overrides: {
					outFile: "out.project.json",
					variants: { mock: true },
				},
			});

			await write("/repo/default.rogen.json", {
				rootDirs: ["b"],
				variants: ["mock"],
			});
			await selection.reload(["/repo/default.rogen.json"]);

			expect(resolved(0)).toMatchObject({
				rootDirs: ["/repo/b"],
				outFile: "/repo/out.project.json",
				variants: { mock: true },
			});
		});
	});

	describe("modes", () => {
		const routes = { "*": "ReplicatedStorage/Shared" };

		it("should build in the mode the config names, with the variants it lists on and its exclude added to the config's", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				variants: ["mock", "debug"],
				exclude: ["**/_*"],
				mode: "dev",
				modes: {
					dev: { variants: ["mock"] },
					prod: { exclude: ["**/*.spec.luau"] },
				},
			});

			await start();

			expect(resolved(0)).toMatchObject({
				mode: "dev",
				modes: ["dev", "prod"],
				variants: { mock: true, debug: false },
				exclude: ["/repo/**/_*"],
			});
		});

		it("should add the mode's exclude to the config's", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				exclude: ["**/_*"],
				mode: "prod",
				modes: { dev: {}, prod: { exclude: ["**/*.spec.luau"] } },
			});

			await start();

			expect(resolved(0)).toMatchObject({
				mode: "prod",
				exclude: ["/repo/**/_*", "/repo/**/*.spec.luau"],
			});
		});

		it("should build in the mode --mode names over the config's own", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				mode: "dev",
				modes: { dev: {}, prod: { exclude: ["Dev"] } },
			});

			await start({ overrides: { mode: "prod", variants: {} } });

			expect(resolved(0)).toMatchObject({
				mode: "prod",
				exclude: ["/repo/Dev"],
			});
		});

		it("should build in the mode --mode names when the config writes none", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				modes: { dev: {}, prod: {} },
			});

			await start({ overrides: { mode: "prod", variants: {} } });

			expect(errors(0)).toEqual([]);
			expect(resolved(0)?.mode).toBe("prod");
		});

		it("should require a mode when modes are declared and nothing names one", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"routes": { "*": "ReplicatedStorage/Shared" },
	"modes": { "dev": {}, "prod": {} }
}`
			);

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.modeRequired",
					resource: "/repo/default.rogen.json",
					position: { line: 3, column: 11 },
					message: expect.stringContaining(
						'Set "mode" to "dev" and "prod", or pass --mode.'
					),
				},
			]);
			expect(resolved(0)).toBeUndefined();
		});

		it("should take the mode from the config it extends", async () => {
			await write("/repo/base.rogen.json", {
				routes,
				mode: "prod",
				modes: { dev: {}, prod: {} },
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
			});

			await start({ names: ["default"] });

			expect(resolved(0)?.mode).toBe("prod");
		});

		it("should turn a variant on with a flag beyond the mode's", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				variants: ["mock", "halloween"],
				mode: "dev",
				modes: { dev: { variants: ["mock"] } },
			});

			await start({ overrides: { variants: { halloween: true } } });

			expect(resolved(0)?.variants).toEqual({
				mock: true,
				halloween: true,
			});
		});

		it("should let --no-variant turn off a variant the mode lists", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				variants: ["mock"],
				mode: "dev",
				modes: { dev: { variants: ["mock"] } },
			});

			await start({ overrides: { variants: { mock: false } } });

			expect(resolved(0)?.variants).toEqual({ mock: false });
		});

		it("should merge modes by name across extends, adding a child's globs and variants to the parent's", async () => {
			await write("/repo/base.rogen.json", {
				routes,
				variants: ["mock", "debug"],
				modes: {
					dev: { variants: ["mock"] },
					prod: { exclude: ["**/*.spec.luau"] },
				},
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
				mode: "prod",
				modes: {
					prod: { exclude: ["Tools"], variants: ["debug"] },
					staging: {},
				},
			});

			await start();

			expect(resolved(0)).toMatchObject({
				mode: "prod",
				modes: ["dev", "prod", "staging"],
				variants: { mock: false, debug: true },
				exclude: ["/repo/**/*.spec.luau", "/repo/Tools"],
			});
		});

		it("should ignore --mode in a config that declares no modes", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				mode: "dev",
				modes: { dev: {}, prod: {} },
			});
			await write("/repo/tools.rogen.json", { routes });

			const result = await start({
				names: ["default", "tools"],
				overrides: { mode: "prod", variants: {} },
			});

			expect(result.isOk()).toBe(true);
			expect(resolved(0)?.mode).toBe("prod");
			expect(resolved(1)?.mode).toBeUndefined();
		});

		it("should refuse --mode when no config being built declares modes", async () => {
			await write("/repo/default.rogen.json", { routes });

			const result = await start({
				overrides: { mode: "prod", variants: {} },
			});

			expect(result.isErr()).toBe(true);
			expect(result.isErr() && result.error).toBeInstanceOf(UsageError);
			expect(result.isErr() && result.error.message).toContain(
				'Mode "prod" is not declared by any config being built'
			);
		});

		it("should break a config that lacks the mode --mode names, so a run never builds it in another", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				mode: "dev",
				modes: { dev: {}, prod: {} },
			});
			await write("/repo/lobby.rogen.json", {
				routes,
				mode: "dev",
				modes: { dev: {}, prd: {} },
			});

			await start({
				names: ["default", "lobby"],
				overrides: { mode: "prod", variants: {} },
			});

			expect(resolved(0)?.mode).toBe("prod");
			expect(errors(1)).toMatchObject([
				{ code: "config.modeNotDeclared" },
			]);
			expect(errors(1)[0].message).toContain('Did you mean "prd"?');
		});

		it("should refuse a variant flag that names a mode", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				mode: "dev",
				modes: { dev: {}, prod: {} },
			});

			const result = await start({
				overrides: { variants: { prod: true } },
			});

			expect(result.isErr() && result.error).toBeInstanceOf(UsageError);
			expect(result.isErr() && result.error.message).toBe(
				'"prod" is a mode, not a variant. Pick it with --mode prod.'
			);
		});

		it("should report a mode field that names no declared mode where it is written", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"routes": { "*": "ReplicatedStorage/Shared" },
	"mode": "prod",
	"modes": { "dev": {} }
}`
			);

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.unknownMode",
					resource: "/repo/default.rogen.json",
					position: { line: 3, column: 10 },
				},
			]);
		});

		it("should report a mode field that names no declared mode even when --mode picks a valid one", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				mode: "prd",
				modes: { dev: {}, prod: {} },
			});

			await start({ overrides: { mode: "prod", variants: {} } });

			expect(errors(0)).toMatchObject([{ code: "config.unknownMode" }]);
			expect(errors(0)[0].message).toContain('Did you mean "prod"?');
		});

		it("should not read a mode named like an Object member as a clash", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				mode: "constructor",
				modes: { constructor: {}, toString: {} },
			});

			await start();

			expect(errors(0)).toEqual([]);
			expect(resolved(0)?.modes).toEqual(["constructor", "toString"]);
		});

		it("should report a mode field in a config that declares no modes", async () => {
			await write("/repo/default.rogen.json", { routes, mode: "prod" });

			await start();

			expect(errors(0)[0]).toMatchObject({ code: "config.unknownMode" });
			expect(errors(0)[0].message).toContain("declares no modes");
		});

		it("should reject a mode body with any field but variants and exclude", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				mode: "prod",
				modes: { prod: { rootDirs: ["src"] } },
			});

			await start();

			expect(errors(0)).toMatchObject([{ code: "config.unknownField" }]);
			expect(errors(0)[0].message).toContain("modes.prod.rootDirs");
		});

		it("should reject a mode named like a route or a variant", async () => {
			await write("/repo/default.rogen.json", {
				routes: { ...routes, Server: "ServerScriptService" },
				variants: ["mock"],
				mode: "Server",
				modes: { Server: {}, mock: {} },
			});

			await start();

			expect(errors(0).map(({ code }) => code)).toEqual([
				"config.modeClashesWithRoute",
				"config.modeClashesWithVariant",
			]);
		});

		it("should reject a mode name that is not a name", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				mode: "1st",
				modes: { "1st": {} },
			});

			await start();

			expect(errors(0)).toMatchObject([
				{ code: "config.invalidModeName" },
			]);
		});

		it("should reject two modes that differ only in their first letter", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				mode: "prod",
				modes: { prod: {}, Prod: {} },
			});

			await start();

			expect(errors(0)).toMatchObject([{ code: "config.ambiguousKey" }]);
		});

		it("should reject a mode that turns on a variant nothing declares, at the entry's own line", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"routes": { "*": "ReplicatedStorage/Shared" },
	"mode": "dev",
	"modes": {
		"dev": { "variants": ["mock"] }
	}
}`
			);

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.undeclaredModeVariant",
					position: { line: 5, column: 25 },
					message: expect.stringContaining("Declare it there."),
				},
			]);
		});

		it("should suggest the declared variant a mode's entry is a typo of", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				variants: ["mock"],
				mode: "dev",
				modes: { dev: { variants: ["mocks"] } },
			});

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.undeclaredModeVariant",
					message: expect.stringContaining('Did you mean "mock"?'),
				},
			]);
		});

		it("should keep the chosen mode across a reload", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				mode: "dev",
				modes: { dev: {}, prod: { exclude: ["a"] } },
			});
			await start({ overrides: { mode: "prod", variants: {} } });

			await write("/repo/default.rogen.json", {
				routes,
				mode: "dev",
				modes: { dev: {}, prod: { exclude: ["b"] } },
			});
			await selection.reload(["/repo/default.rogen.json"]);

			expect(resolved(0)).toMatchObject({
				mode: "prod",
				exclude: ["/repo/b"],
			});
		});

		it("should give every declared mode its own view of the config, with only the variants it lists on", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				variants: ["mock"],
				exclude: ["x"],
				mode: "prod",
				modes: {
					dev: { variants: ["mock"] },
					prod: { exclude: ["y"] },
				},
			});

			await start({ overrides: { variants: { mock: true } } });

			expect(resolved(0)?.variants).toEqual({ mock: true });
			const dev = resolved(0)?.inMode("dev");
			expect(dev).toMatchObject({
				mode: "dev",
				variants: { mock: true },
				exclude: ["/repo/x"],
			});
			const prod = resolved(0)?.inMode("prod");
			expect(prod).toMatchObject({
				mode: "prod",
				variants: { mock: false },
				exclude: ["/repo/x", "/repo/y"],
			});
			expect(resolved(0)?.inMode("nope")).toBeUndefined();
		});
	});

	describe("old variants map", () => {
		it("should say variants is a list now, and where modes take over", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"variants": { "mock": true }
}`
			);

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.variantsAreAList",
					position: { line: 2, column: 14 },
					message: expect.stringContaining('["mock", "debug"]'),
				},
			]);
			expect(errors(0)[0].message).toContain("core-concepts/modes");
		});

		it("should say the same of a mode's variants", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"variants": ["mock"],
	"mode": "dev",
	"modes": { "dev": { "variants": { "mock": true } } }
}`
			);

			await start();

			expect(errors(0)).toMatchObject([
				{ code: "config.variantsAreAList" },
			]);
			expect(errors(0)[0].message).toContain('"modes.dev.variants"');
		});
	});

	describe("conflicts", () => {
		const routes = { "*": "ReplicatedStorage/Shared" };
		const base = {
			routes,
			variants: ["mock", "halloween", "christmas"],
			conflicts: [["halloween", "christmas"]],
		};

		it("should hold the groups on the resolved config", async () => {
			await write("/repo/default.rogen.json", base);

			await start();

			expect(resolved(0)?.conflicts).toEqual([
				["halloween", "christmas"],
			]);
		});

		it("should allow one variant of a group", async () => {
			await write("/repo/default.rogen.json", base);

			await start({ overrides: { variants: { halloween: true } } });

			expect(errors(0)).toEqual([]);
			expect(resolved(0)?.variants.halloween).toBe(true);
		});

		it("should refuse two variants of a group the command line turns on", async () => {
			await write("/repo/default.rogen.json", base);

			await start({
				overrides: { variants: { halloween: true, christmas: true } },
			});

			expect(errors(0)).toMatchObject([
				{
					code: "config.variantConflict",
					message: expect.stringContaining(
						'variants "halloween" and "christmas" conflict'
					),
				},
			]);
			expect(errors(0)[0].message).toContain("Pass only one of them.");
		});

		it("should refuse a variant the command line adds to one the mode turns on, and suggest turning the mode's off", async () => {
			await write("/repo/default.rogen.json", {
				...base,
				mode: "dev",
				modes: { dev: { variants: ["halloween"] } },
			});

			await start({ overrides: { variants: { christmas: true } } });

			expect(errors(0)).toMatchObject([
				{ code: "config.variantConflict" },
			]);
			expect(errors(0)[0].message).toContain(
				'halloween from mode "dev", christmas from --variant'
			);
			expect(errors(0)[0].message).toContain(
				"--no-variant halloween --variant christmas"
			);
		});

		it("should accept the swap the error suggests", async () => {
			await write("/repo/default.rogen.json", {
				...base,
				mode: "dev",
				modes: { dev: { variants: ["halloween"] } },
			});

			await start({
				overrides: { variants: { halloween: false, christmas: true } },
			});

			expect(errors(0)).toEqual([]);
			expect(resolved(0)?.variants).toEqual({
				mock: false,
				halloween: false,
				christmas: true,
			});
		});

		it("should refuse a mode that turns on two variants of a group, at the second", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"routes": { "*": "ReplicatedStorage/Shared" },
	"variants": ["halloween", "christmas"],
	"conflicts": [["halloween", "christmas"]],
	"mode": "dev",
	"modes": { "dev": { "variants": ["halloween", "christmas"] } }
}`
			);

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.modeConflict",
					position: { line: 6, column: 48 },
					message: expect.stringContaining(
						'mode "dev" turns on "halloween" and "christmas"'
					),
				},
			]);
		});

		it("should not repeat a conflict a mode alone causes when the command line adds another", async () => {
			await write("/repo/default.rogen.json", {
				...base,
				mode: "dev",
				modes: { dev: { variants: ["halloween", "christmas"] } },
			});

			await start({ overrides: { variants: { mock: true } } });

			expect(errors(0).map(({ code }) => code)).toEqual([
				"config.modeConflict",
			]);
		});

		it("should check every group a variant sits in", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				variants: ["a", "b", "c"],
				conflicts: [
					["a", "b"],
					["b", "c"],
				],
			});

			await start({ overrides: { variants: { b: true, c: true } } });

			expect(errors(0)).toMatchObject([
				{ code: "config.variantConflict" },
			]);
			expect(errors(0)[0].message).toContain('"b" and "c"');
		});

		it("should refuse a group that names a mode", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"routes": { "*": "ReplicatedStorage/Shared" },
	"variants": ["mock"],
	"conflicts": [["mock", "prod"]],
	"mode": "prod",
	"modes": { "prod": {} }
}`
			);

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.conflictNamesMode",
					position: { line: 4, column: 16 },
				},
			]);
		});

		it("should refuse a group that names an undeclared variant, and suggest the near miss", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				variants: ["halloween", "christmas"],
				conflicts: [["halloween", "christmass"]],
			});

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.conflictUndeclaredVariant",
					message: expect.stringContaining(
						'Did you mean "christmas"?'
					),
				},
			]);
		});

		it("should add a place's group to the shared ones", async () => {
			await write("/repo/base.rogen.json", {
				routes,
				variants: ["a", "b", "c"],
				conflicts: [["a", "b"]],
			});
			await write("/repo/lobby.rogen.json", {
				extends: "./base.rogen.json",
				conflicts: [["b", "c"]],
			});

			await start({ names: ["lobby"] });

			expect(resolved(0)?.conflicts).toEqual([
				["a", "b"],
				["b", "c"],
			]);
		});
	});
});
