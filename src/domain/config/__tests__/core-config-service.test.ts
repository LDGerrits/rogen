import { jest } from "@jest/globals";
import "../config.js";
import { ResultError } from "../../../base/result.js";
import { ConfigChangeEvent } from "../../../platform/config/config.js";
import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ConfigRefs } from "../config-service.js";
import { CoreConfigService } from "../core-config-service.js";

describe("domain/config/core-config-service", () => {
	let fs: MemoryFileSystemService;
	let service: CoreConfigService;

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
		service = new CoreConfigService(
			fs,
			new MockEnvironmentService({ _: [] }, "/repo")
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
				template: "/repo/one.project.json",
				syncDir: "/repo/dist",
			});
		});

		it("should resolve a parent's relative paths against the parent's directory", async () => {
			await fs.createDirectory("/repo/shared");
			await fs.createDirectory("/repo/places");
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
				template: "/repo/shared/template.project.json",
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
			await write("/repo/one.rogen.json", { extends: "./base.rogen.json" });
			await write("/repo/two.rogen.json", { extends: "./base.rogen.json" });
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
});
