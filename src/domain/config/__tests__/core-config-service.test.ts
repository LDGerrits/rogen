import { jest } from "@jest/globals";
import "../config.js";
import { ResultError } from "../../../base/result.js";
import { ConfigChangeEvent } from "../../../platform/config/config.js";
import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { NullLogService } from "../../../platform/log/log-service.js";
import { ConfigRefs } from "../config-service.js";
import { CoreConfigService } from "../core-config-service.js";

describe("domain/config/core-config-service", () => {
	let fs: MemoryFileSystemService;
	let service: CoreConfigService;
	let logService: NullLogService;

	const write = (file: string, config: Record<string, unknown> | string) =>
		fs.writeFile(
			file,
			typeof config === "string" ? config : JSON.stringify(config)
		);

	const start = async (refs: Partial<ConfigRefs> = {}) => {
		const result = await service.initialize({
			names: [],
			paths: [],
			...refs,
		});
		return result;
	};

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo");
		logService = new NullLogService();
		service = new CoreConfigService(
			fs,
			new MockEnvironmentService({ _: [] }, "/repo"),
			logService
		);
	});

	afterEach(() => {
		service[Symbol.dispose]();
	});

	describe("initialize", () => {
		it("should resolve the default config with defaults applied", async () => {
			await write("/repo/default.rogen.json", {});

			expect((await start()).isOk()).toBe(true);

			const [entry] = service.configs;
			expect(entry.file).toBe("/repo/default.rogen.json");
			expect(entry.diagnostics).toEqual([]);
			expect(entry.resolved).toMatchObject({
				rootDirs: ["/repo/src"],
				routes: {},
				tags: {},
				exclude: [],
				outFile: "/repo/default.project.json",
			});
		});

		it("should resolve several named configs in one service", async () => {
			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			await write("/repo/source.rogen.json", { rootDirs: ["b"] });

			await start({ names: ["default", "source"] });

			expect(service.configs.map((c) => c.resolved?.rootDirs)).toEqual([
				["/repo/a"],
				["/repo/b"],
			]);
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

			const [good, bad] = service.configs;
			expect(good.diagnostics).toEqual([]);
			expect(good.resolved).toBeDefined();
			expect(bad.diagnostics).toMatchObject([
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

			expect(service.configs[0].resolved).toBeUndefined();
		});

		it("should initialize two configs writing the same outFile", async () => {
			await write("/repo/a.rogen.json", { outFile: "same.project.json" });
			await write("/repo/b.rogen.json", { outFile: "same.project.json" });

			const result = await start({ names: ["a", "b"] });

			expect(result.isOk()).toBe(true);
			expect(service.configs.map((c) => c.diagnostics)).toEqual([[], []]);
		});

		it("should list every file of every chain", async () => {
			await write("/repo/base.rogen.json", {});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
			});

			await start();

			expect(service.files).toEqual(
				new Set(["/repo/default.rogen.json", "/repo/base.rogen.json"])
			);
		});
	});

	describe("extends", () => {
		it("should merge maps key by key with the child winning", async () => {
			await write("/repo/base.rogen.json", {
				routes: { server: "ServerScriptService", "*": "ServerStorage" },
				tags: { mock: false, debug: true },
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
				routes: {
					"*": "ReplicatedStorage/shared",
					client: "StarterGui",
				},
				tags: { mock: true },
			});

			await start();

			expect(service.configs[0].resolved).toMatchObject({
				routes: {
					server: "ServerScriptService",
					"*": "ReplicatedStorage/shared",
					client: "StarterGui",
				},
				tags: { mock: true, debug: true },
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

			expect(service.configs[0].resolved).toMatchObject({
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

			expect(service.configs[0].resolved).toMatchObject({
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

			await service.initialize({
				names: [],
				paths: ["places/default.rogen.json"],
			});

			expect(service.configs[0].resolved).toMatchObject({
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

			expect(service.configs[0].resolved?.outFile).toBe(
				"/repo/default.project.json"
			);
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

			expect(service.configs[0].resolved?.outFile).toBe(
				"/repo/build/game.project.json"
			);
		});

		it("should resolve a three-deep chain from the outermost ancestor inwards", async () => {
			await write("/repo/core.rogen.json", {
				rootDirs: ["core"],
				routes: { server: "ServerScriptService", client: "StarterGui" },
				tags: { mock: false },
			});
			await write("/repo/lobby-source.rogen.json", {
				extends: "./core.rogen.json",
				rootDirs: ["core", "places/lobby"],
				routes: { client: "StarterPlayer/StarterPlayerScripts" },
			});
			await write("/repo/lobby.rogen.json", {
				extends: "./lobby-source.rogen.json",
				syncDir: "dist/lobby",
				tags: { mock: true },
			});

			await start({ names: ["lobby"] });

			expect(service.configs[0].chain).toEqual([
				"/repo/lobby.rogen.json",
				"/repo/lobby-source.rogen.json",
				"/repo/core.rogen.json",
			]);
			expect(service.configs[0].resolved).toEqual({
				name: "repo",
				rootDirs: ["/repo/core", "/repo/places/lobby"],
				routes: {
					server: "ServerScriptService",
					client: "StarterPlayer/StarterPlayerScripts",
				},
				tags: { mock: true },
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
				new MockEnvironmentService({ _: [] }, "/repo"),
				logService
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

			expect(service.configs[0].diagnostics).toEqual([
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

			const [diagnostic] = service.configs[0].diagnostics;
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

			const [diagnostic] = service.configs[0].diagnostics;
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

			expect(service.configs[0].diagnostics).toMatchObject([
				{
					resource: "/repo/base.rogen.json",
					code: "config.unknownField",
				},
			]);
			expect(service.files).toContain("/repo/base.rogen.json");
		});

		it("should reject null in an ancestor's routes and tags", async () => {
			await write("/repo/base.rogen.json", {
				routes: { server: null },
				tags: { mock: null },
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
			});

			await start();

			expect(
				service.configs[0].diagnostics.map((d) => [
					d.resource,
					d.message,
				])
			).toEqual([
				[
					"/repo/base.rogen.json",
					'"routes.server": expected a string, found null.',
				],
				[
					"/repo/base.rogen.json",
					'"tags.mock": expected a boolean, found null.',
				],
			]);
		});

		it("should keep a trailing slash on an excluded directory", async () => {
			await write("/repo/default.rogen.json", { exclude: ["dist/"] });

			await start();

			expect(service.configs[0].resolved?.exclude).toEqual([
				"/repo/dist/",
			]);
		});
	});

	describe("reload", () => {
		const listen = () => {
			const listener = jest.fn<(event: ConfigChangeEvent) => void>();
			service.onDidChangeConfig(listener);
			return listener;
		};

		it("should fire one change event per affected config, naming it", async () => {
			await write("/repo/base.rogen.json", { rootDirs: ["a"] });
			await write("/repo/one.rogen.json", {
				extends: "./base.rogen.json",
			});
			await write("/repo/two.rogen.json", {
				extends: "./base.rogen.json",
			});
			await write("/repo/other.rogen.json", { rootDirs: ["z"] });
			await start({ names: ["one", "two", "other"] });
			const listener = listen();

			await write("/repo/base.rogen.json", { rootDirs: ["b"] });
			await service.reload(["/repo/base.rogen.json"]);

			expect(listener).toHaveBeenCalledTimes(2);
			expect(listener.mock.calls.map(([e]) => e.resource)).toEqual([
				"/repo/one.rogen.json",
				"/repo/two.rogen.json",
			]);
			const [event] = listener.mock.calls[0];
			expect(event.affectsConfig("rootDirs")).toBe(true);
			expect(event.affectsConfig("routes")).toBe(false);
			expect(service.configs[0].resolved?.rootDirs).toEqual(["/repo/b"]);
			expect(service.configs[2].resolved?.rootDirs).toEqual(["/repo/z"]);
		});

		it("should fire nothing when the resolved value is unchanged", async () => {
			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			await start();
			const listener = listen();

			await write("/repo/default.rogen.json", {
				rootDirs: ["a"],
			});
			await service.reload(["/repo/default.rogen.json"]);

			expect(listener).not.toHaveBeenCalled();
		});

		it("should keep the last valid value when a reload breaks the config", async () => {
			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			await start();
			const listener = listen();

			await write(
				"/repo/default.rogen.json",
				`{
	"rootDirs": ["b"],
	"bogus": 1
}`
			);
			await service.reload(["/repo/default.rogen.json"]);

			const [entry] = service.configs;
			expect(entry.resolved?.rootDirs).toEqual(["/repo/a"]);
			expect(entry.diagnostics).toMatchObject([
				{
					code: "config.unknownField",
					position: { line: 3, column: 2 },
				},
			]);
			expect(listener).not.toHaveBeenCalled();
		});

		it("should clear the diagnostics and fire once the file is fixed", async () => {
			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			await start();
			await write("/repo/default.rogen.json", { bogus: 1 });
			await service.reload(["/repo/default.rogen.json"]);
			const listener = listen();

			await write("/repo/default.rogen.json", { rootDirs: ["c"] });
			await service.reload(["/repo/default.rogen.json"]);

			expect(service.configs[0].diagnostics).toEqual([]);
			expect(service.configs[0].resolved?.rootDirs).toEqual(["/repo/c"]);
			expect(listener).toHaveBeenCalledTimes(1);
		});

		it("should fire when a config that was never valid becomes valid", async () => {
			await write("/repo/default.rogen.json", "{ nope");
			await start();
			const listener = listen();

			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			await service.reload(["/repo/default.rogen.json"]);

			expect(service.configs[0].resolved?.rootDirs).toEqual(["/repo/a"]);
			expect(listener).toHaveBeenCalledTimes(1);
		});

		it("should ignore files no config reads", async () => {
			await write("/repo/default.rogen.json", {});
			await start();
			const before = service.configs;

			await service.reload(["/repo/unrelated.json"]);

			expect(service.configs[0]).toBe(before[0]);
		});
	});

	describe("resolution", () => {
		const diagnosticsFor = async (
			config: Record<string, unknown> | string,
			file = "default"
		) => {
			await write(`/repo/${file}.rogen.json`, config);
			await start({ names: [file] });
			return service.configs[0].diagnostics.map((d) => [
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

			expect(service.configs[0].resolved).toMatchObject({
				exclude: ["/repo/**/*.spec.luau"],
				rootDirs: ["/repo/core"],
				routes: {},
				tags: {},
			});
		});

		it("should not inject a route set when the chain declares no routes", async () => {
			await write("/repo/default.rogen.json", {});

			await start();

			expect(service.configs[0].resolved?.routes).toEqual({});
		});

		it("should default outFile from the config's stem", async () => {
			await write("/repo/lobby.rogen.json", {});

			await start({ names: ["lobby"] });

			expect(service.configs[0].resolved?.outFile).toBe(
				"/repo/lobby.project.json"
			);
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

				expect(service.configs[0].resolved?.name).toBe("FromTemplate");
			});

			it("should fall back to the config's directory when the template has no name", async () => {
				await write("/repo/t.project.json", { tree: {} });
				await write("/repo/default.rogen.json", {
					template: "t.project.json",
				});

				await start();

				expect(service.configs[0].resolved?.name).toBe("repo");
			});

			it("should fall back to the config's directory when there is no template", async () => {
				await write("/repo/default.rogen.json", {});

				await start();

				expect(service.configs[0].resolved?.name).toBe("repo");
			});

			it("should never be empty", async () => {
				fs = new MemoryFileSystemService();
				service = new CoreConfigService(
					fs,
					new MockEnvironmentService({ _: [] }, "/"),
					logService
				);
				await write("/default.rogen.json", {});

				await start();

				expect(service.configs[0].resolved?.name).toBe("project");
			});

			it("should ignore an empty template name", async () => {
				await write("/repo/t.project.json", { name: "", tree: {} });
				await write("/repo/default.rogen.json", {
					template: "t.project.json",
				});

				await start();

				expect(service.configs[0].resolved?.name).toBe("repo");
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

				expect(service.configs[0].resolved?.template).toEqual({
					file: "/repo/t.project.json",
					project: {
						name: "Game",
						tree: { $className: "DataModel" },
					},
				});
				expect(service.files).toContain("/repo/t.project.json");
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
				expect(service.files).toContain("/repo/missing.project.json");
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

			it("should fire a change when the template's contents change", async () => {
				await write("/repo/t.project.json", { name: "One", tree: {} });
				await write("/repo/default.rogen.json", {
					template: "t.project.json",
				});
				await start();
				const listener = jest.fn<(event: ConfigChangeEvent) => void>();
				service.onDidChangeConfig(listener);

				await write("/repo/t.project.json", { name: "Two", tree: {} });
				await service.reload(["/repo/t.project.json"]);

				expect(service.configs[0].resolved?.name).toBe("Two");
				expect(listener).toHaveBeenCalledTimes(1);
				expect(
					listener.mock.calls[0][0].affectsConfig("template")
				).toBe(true);
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

			it("should reject a tag name that starts with a digit", async () => {
				const problems = await diagnosticsFor(`{
	"tags": { "1st": true }
}`);

				expect(problems).toEqual([
					[
						'tag "1st" is invalid: use letters and digits only, starting with a letter.',
						"/repo/default.rogen.json",
						2,
						19,
					],
				]);
			});

			it("should reject a tag that shares a name with a route key", async () => {
				const problems = await diagnosticsFor(`{
	"routes": { "server": "ServerScriptService" },
	"tags": { "server": true }
}`);

				expect(problems).toEqual([
					[
						'tag "server" has the same name as a route key; rename one of them.',
						"/repo/default.rogen.json",
						3,
						22,
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

			it("should reject two tags that differ only in the case of their first letter", async () => {
				const problems = await diagnosticsFor(`{
	"tags": { "mock": true, "Mock": false }
}`);

				expect(problems).toHaveLength(1);
				expect(problems[0][0]).toContain('"Mock" and "mock"');
			});

			it("should reject a tag that differs from a route key only in the case of its first letter", async () => {
				const problems = await diagnosticsFor(`{
	"routes": { "server": "ServerScriptService" },
	"tags": { "Server": true }
}`);

				expect(problems).toHaveLength(1);
				expect(problems[0][0]).toContain('"Server" and "server"');
			});

			it("should accept keys that differ beyond the first letter", async () => {
				expect(
					await diagnosticsFor({
						routes: { server: "ServerScriptService" },
						tags: { SERVER: true },
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
					tags: { "c-d": true },
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
				await service.reload(["/repo/default.rogen.json"]);

				expect(service.configs[0].resolved?.rootDirs).toEqual([
					"/repo/a",
				]);
				expect(service.configs[0].diagnostics).toHaveLength(1);
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
					tags: {},
				},
			});

			expect(service.configs[0].resolved).toMatchObject({
				outFile: "/repo/out/new.project.json",
				syncDir: "/repo/dist",
				template: { file: "/repo/base.project.json" },
			});
		});

		it("should turn a declared tag on or off and leave the others", async () => {
			await write("/repo/default.rogen.json", {
				tags: { mock: false, dev: true, prod: false },
			});

			await start({ overrides: { tags: { mock: true, dev: false } } });

			expect(service.configs[0].resolved?.tags).toEqual({
				mock: true,
				dev: false,
				prod: false,
			});
		});

		it("should fail when no named config declares the tag", async () => {
			await write("/repo/lobby.rogen.json", { tags: { mock: false } });
			await write("/repo/match.rogen.json", {});

			const result = await start({
				names: ["lobby", "match"],
				overrides: { tags: { ghost: true } },
			});

			expect((result as ResultError<Error>).error.message).toContain(
				'"ghost"'
			);
		});

		it("should apply a tag where it is declared and say where it was skipped", async () => {
			await write("/repo/lobby.rogen.json", { tags: { mock: false } });
			await write("/repo/match.rogen.json", {});
			const debug = jest.spyOn(logService, "debug");

			const result = await start({
				names: ["lobby", "match"],
				overrides: { tags: { mock: true } },
			});

			expect(result.isOk()).toBe(true);
			expect(service.configs.map((c) => c.resolved?.tags)).toEqual([
				{ mock: true },
				{},
			]);
			expect(debug).toHaveBeenCalledWith(
				expect.stringContaining("match.rogen.json")
			);
			expect(debug).toHaveBeenCalledTimes(1);
		});

		it("should not fail on a tag when a named config could not be read", async () => {
			await write("/repo/lobby.rogen.json", "{ nope");

			const result = await start({
				names: ["lobby"],
				overrides: { tags: { mock: true } },
			});

			expect(result.isOk()).toBe(true);
		});

		it("should keep the overrides across a reload", async () => {
			await write("/repo/default.rogen.json", {
				rootDirs: ["a"],
				tags: { mock: false },
			});
			await start({
				overrides: {
					outFile: "out.project.json",
					tags: { mock: true },
				},
			});

			await write("/repo/default.rogen.json", {
				rootDirs: ["b"],
				tags: { mock: false },
			});
			await service.reload(["/repo/default.rogen.json"]);

			expect(service.configs[0].resolved).toMatchObject({
				rootDirs: ["/repo/b"],
				outFile: "/repo/out.project.json",
				tags: { mock: true },
			});
		});
	});
});
