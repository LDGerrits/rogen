import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import path from "path";
import { toPosix } from "../../../base/path.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { configServiceOf } from "../../config/__tests__/config-of.js";
import { abs, writeServiceOf } from "./fixtures.js";

const KEYS = "src/F/InputController/Keys.luau";
const NOPE = "src/I/Nope.meta.json";

const byCode = (diagnostics: readonly Diagnostic[]) =>
	[...diagnostics].sort((a, b) => a.code.localeCompare(b.code));

const codesOf = (diagnostics: readonly Diagnostic[]) =>
	diagnostics.map(({ code }) => code);

describe("CoreWriteService.diagnose", () => {
	let fs: MemoryFileSystemService;

	const diagnose = async (...args: string[]) =>
		(
			await writeServiceOf(fs).diagnose({
				args,
				cwd: abs(),
			})
		).unwrap();

	const configure = (config: object) =>
		fs.writeFile(abs("default.rogen.json"), JSON.stringify(config));

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory(abs(".git"));
	});

	describe("a path of a config that writes", () => {
		beforeEach(async () => {
			await configure({
				sourcePaths: ["src"],
				routes: {
					client: "StarterPlayer/StarterPlayerScripts",
					"*Controller": "StarterPlayer/StarterPlayerScripts",
					"*": "ReplicatedStorage",
				},
				compiledPath: "out",
			});
			await fs.writeFile(abs("default.project.json"), "{}");
			await fs.writeFile(abs("src/F/InputController/init.luau"), "");
			await fs.writeFile(abs("src/F/InputController/Keys.luau"), "");
			await fs.writeFile(abs("src/I/Nope.meta.json"), "{}");
			await fs.writeFile(abs("src/I/B.luau"), "");
			await fs.writeFile(abs("src/G/C.luau"), "");
		});

		it("should find in the whole check a finding of each kind", async () => {
			const whole = await diagnose();

			expect(codesOf(whole.diagnostics).sort()).toEqual([
				"meta.unclaimed",
				"output.differs",
				"output.nothingEmitted",
				"route.folderPattern",
			]);
		});

		it.each([
			["src/G/C.luau", []],
			["src/F/InputController/Keys.luau", ["route.folderPattern"]],
			["src/F/InputController", ["route.folderPattern"]],
			["src/F", ["route.folderPattern"]],
			["src/I/Nope.meta.json", ["meta.unclaimed"]],
			["src/I", ["meta.unclaimed"]],
			["src", ["meta.unclaimed", "route.folderPattern"]],
		])(
			"should give for %s the whole check's findings about it and the config's own",
			async (asked, about) => {
				const whole = await diagnose();
				const shown = new Set([
					...about,
					"output.differs",
					"output.nothingEmitted",
				]);

				const scoped = await diagnose(asked);

				expect(byCode(scoped.diagnostics)).toEqual(
					byCode(
						whole.diagnostics.filter(({ code }) => shown.has(code))
					)
				);
				expect(scoped.stoppedBy).toEqual([]);
				expect(scoped.failing).toEqual(scoped.diagnostics);
			}
		);

		it.each([
			[
				[KEYS, NOPE],
				["route.folderPattern", "meta.unclaimed"],
			],
			[
				[NOPE, KEYS],
				["meta.unclaimed", "route.folderPattern"],
			],
		])(
			"should give the findings for %j in the order the files are asked, the config's own last",
			async (asked, about) => {
				expect(codesOf((await diagnose(...asked)).diagnostics)).toEqual(
					[...about, "output.differs", "output.nothingEmitted"]
				);
			}
		);
	});

	describe("a path that does not exist yet", () => {
		beforeEach(async () => {
			await configure({
				sourcePaths: ["src"],
				routes: { "*": "ReplicatedStorage" },
			});
			await fs.writeFile(abs("src/G/C.luau"), "");
		});

		const writeProjectFile = async () => {
			const configService = configServiceOf(
				fs,
				new MockEnvironmentService(abs())
			);
			const selection = (
				await configService.select(await configService.configsHere())
			).unwrap();
			await writeServiceOf(
				fs,
				new CoreIndexService(fs),
				[],
				configService
			).write(selection);
		};

		it("should give a project file that is out of date without it", async () => {
			await fs.writeFile(abs("default.project.json"), "{}");

			expect(
				codesOf((await diagnose("src/H/New.luau")).diagnostics)
			).toEqual(["output.differs"]);
		});

		it("should not give a project file that only it would change", async () => {
			await writeProjectFile();

			expect((await diagnose("src/H/New.luau")).diagnostics).toEqual([]);
		});
	});

	describe("a path of a config that errors stop", () => {
		beforeEach(async () => {
			await configure({
				sourcePaths: ["src"],
				routes: {
					server: "ServerScriptService",
					"*": "ReplicatedStorage",
				},
			});
			await fs.writeFile(abs("src/F/Server/A.luau"), "");
			await fs.writeFile(abs("src/Combat/init.meta.json"), "[]");
			await fs.writeFile(abs("src/Combat/A.luau"), "");
			await fs.writeFile(abs("src/B.luau"), "");
		});

		it("should give a folder's error for a file in it", async () => {
			const scoped = await diagnose("src/F/Server/A.luau");

			expect(codesOf(scoped.diagnostics)).toEqual(["route.caseMismatch"]);
			expect(codesOf(scoped.stoppedBy)).toEqual(["meta.notAnObject"]);
		});

		it("should name the files whose errors stop it, and fail", async () => {
			const whole = await diagnose();

			const scoped = await diagnose("src/B.luau");

			expect(scoped.diagnostics).toEqual([]);
			expect(scoped.stoppedBy).toEqual(whole.diagnostics);
			expect(
				scoped.stoppedBy.map(({ resource }) => resource).sort()
			).toEqual([abs("src/Combat/init.meta.json"), abs("src/F/Server")]);
			expect(scoped.failing).toEqual(scoped.stoppedBy);
		});
	});

	it("should give a config's own errors for any path of it", async () => {
		await configure({ sourcePaths: ["src"], nope: true });
		await fs.writeFile(abs("src/A.luau"), "");

		const whole = await diagnose();

		expect(await diagnose("src/A.luau")).toMatchObject({
			diagnostics: whole.diagnostics,
			stoppedBy: [],
		});
		expect(codesOf(whole.diagnostics)).toEqual(["config.unknownField"]);
	});

	describe("what it is asked", () => {
		const place = (name: string) =>
			fs.writeFile(
				abs(`places/${name}/default.rogen.json`),
				JSON.stringify({
					name,
					sourcePaths: ["../shared/src", "src"],
					routes: { "*": "ReplicatedStorage" },
				})
			);

		const ask = (...args: string[]) =>
			writeServiceOf(fs).diagnose({
				args,
				cwd: abs(),
			});

		beforeEach(async () => {
			await fs.writeFile(abs("places/shared/src/A.luau"), "");
		});

		it("should fail on a name that both extensions of a config have", async () => {
			await fs.writeFile(abs("game.rogen.json"), "{}");
			await fs.writeFile(abs("game.rogen.jsonc"), "{}");

			expect((await ask("game")).isErr()).toBe(true);
		});

		it("should fail on an instance when no config is here to place it", async () => {
			expect((await ask("ReplicatedStorage.A")).isErr()).toBe(true);
		});

		it("should skip a path no config lies above, naming the configs that read it", async () => {
			await place("lobby");
			const file = abs("places/shared/src/A.luau");

			const found = (await ask(file)).unwrap();

			expect(found.skipped).toEqual([
				{
					path: file,
					reason: "noConfig",
					readers: [abs("places/lobby/default.rogen.json")],
				},
			]);
			expect(found.failing).toEqual([]);
		});

		it("should give the configs here to name when a path has no reader", async () => {
			await fs.writeFile(abs("game.rogen.json"), "{}");
			await fs.writeFile(abs("elsewhere/B.luau"), "");

			const found = (await ask("elsewhere/B.luau")).unwrap();

			expect(found.skipped).toMatchObject([{ reason: "noConfig" }]);
			expect(found.named).toEqual([abs("game.rogen.json")]);
		});
	});

	describe("which configs answer a path", () => {
		const ROUTES = {
			Server: "ServerScriptService",
			"*": "ReplicatedStorage/Shared",
		};

		const writeConfig = (file: string, config: object) =>
			fs.writeFile(abs(file), JSON.stringify(config));

		const write = async (...files: string[]) => {
			for (const file of files) await fs.writeFile(abs(file), "");
		};

		const askIn = (cwd: string, ...args: string[]) =>
			writeServiceOf(
				fs,
				new CoreIndexService(fs),
				[],
				configServiceOf(fs, new MockEnvironmentService(cwd))
			).diagnose({ args, cwd });

		const failingOf = async (...args: string[]) =>
			found((await askIn(abs(), ...args)).unwrap().failing);

		const filesOf = async (...args: string[]) =>
			new Set((await failingOf(...args)).map(([, file]) => file));

		const found = (diagnostics: readonly Diagnostic[]) =>
			diagnostics.map(({ code, resource }) => [
				code,
				toPosix(path.relative(abs(), resource)),
			]);

		describe("with named configs, one of which doesn't load", () => {
			const lobby = (broken: Record<string, unknown>) =>
				writeConfig("lobby.rogen.json", {
					name: "lobby",
					routes: ROUTES,
					sourcePaths: ["src/lobby"],
					...broken,
				});

			beforeEach(async () => {
				await writeConfig("game.rogen.json", {
					name: "game",
					routes: ROUTES,
					sourcePaths: ["src/game"],
				});
				await write("src/game/Clean.luau", "src/lobby/Clean.luau");
			});

			it.each([
				["an unknown key", { unknownKey: true }],
				["a key of the wrong type", { name: 5 }],
				["routes of the wrong type", { routes: "x" }],
			])(
				"should pass a path its source paths don't read, when it has %s",
				async (_, broken) => {
					await lobby(broken);

					expect(await failingOf("src/game")).toEqual([]);
				}
			);

			it("should fail on a path its source paths read", async () => {
				await lobby({ unknownKey: true });

				expect(await failingOf("src/lobby")).toContainEqual([
					"config.unknownField",
					"lobby.rogen.json",
				]);
			});

			it("should fail on every path when its source paths can't be read", async () => {
				await lobby({ sourcePaths: "src/lobby" });

				expect(await failingOf("src/game")).toContainEqual([
					"config.wrongType",
					"lobby.rogen.json",
				]);
			});
		});

		describe("with several places", () => {
			beforeEach(async () => {
				for (const place of ["lobby", "arena"])
					await writeConfig(`places/${place}/default.rogen.json`, {
						name: place,
						sourcePaths: ["../shared/src", "src"],
						routes: ROUTES,
					});
				await write(
					"places/shared/src/Stray.client.luau",
					"places/lobby/src/Buy.client.luau",
					"places/lobby/src/Clean.luau",
					"places/arena/src/Sell.client.luau"
				);
			});

			it("should check a file of a place from the root, by the config of that place", async () => {
				expect(
					await failingOf("places/lobby/src/Buy.client.luau")
				).toEqual([
					["tree.deadScript", "places/lobby/src/Buy.client.luau"],
				]);
			});

			it("should check files of two places, each by its own config", async () => {
				expect(
					await failingOf(
						"places/lobby/src/Buy.client.luau",
						"places/arena/src/Sell.client.luau"
					)
				).toEqual([
					["tree.deadScript", "places/lobby/src/Buy.client.luau"],
					["tree.deadScript", "places/arena/src/Sell.client.luau"],
				]);
			});

			it("should check the files that have a config and skip the rest", async () => {
				const found = (
					await askIn(
						abs(),
						"places/shared/src/Stray.client.luau",
						"places/lobby/src/Buy.client.luau"
					)
				).unwrap();

				expect(codesOf(found.failing)).toEqual(["tree.deadScript"]);
				expect(found.skipped).toHaveLength(1);
			});

			it("should skip no file that a config named beside it reads", async () => {
				const found = (
					await askIn(
						abs(),
						"places/lobby/default.rogen.json",
						"places/shared/src/Stray.client.luau"
					)
				).unwrap();

				expect(found.skipped).toEqual([]);
			});

			it("should check a config named by its file whole", async () => {
				expect(
					await filesOf("places/lobby/default.rogen.json")
				).toEqual(
					new Set([
						"places/lobby/src/Buy.client.luau",
						"places/shared/src/Stray.client.luau",
					])
				);
			});

			it("should check a folder by its own config", async () => {
				expect(await failingOf("places/arena")).toEqual([
					["tree.deadScript", "places/arena/src/Sell.client.luau"],
				]);
			});

			it.each(["places/arena", "places/arena/src/Sell.client.luau"])(
				"should report the stale project file of the config that holds %s",
				async (asked) => {
					await fs.writeFile(
						abs("places/arena/default.project.json"),
						"{}"
					);

					expect(await failingOf(asked)).toContainEqual([
						"output.differs",
						"places/arena/default.project.json",
					]);
				}
			);

			it("should not search upward for a bare check at the root", async () => {
				const result = await askIn(abs());

				expect(result.isErr()).toBe(true);
				expect((result as { error: Error }).error.message).toContain(
					"No default.rogen.json or default.project.json in this folder"
				);
			});

			it("should check the folder's own default for a bare check in a place", async () => {
				const found = (await askIn(abs("places/lobby"))).unwrap();

				expect(
					new Set(
						found.failing.map(({ resource }) =>
							toPosix(path.relative(abs(), resource))
						)
					)
				).toEqual(
					new Set([
						"places/lobby/src/Buy.client.luau",
						"places/shared/src/Stray.client.luau",
					])
				);
			});
		});

		describe("with root-level places", () => {
			beforeEach(async () => {
				for (const place of ["game", "lobby"])
					await writeConfig(`${place}.rogen.json`, {
						name: place,
						sourcePaths: ["src/common", `src/${place}`],
						routes: ROUTES,
					});
				await write(
					"src/common/Stray.client.luau",
					"src/game/Buy.client.luau",
					"src/lobby/Clean.luau"
				);
			});

			it("should check a file of a place by the config that holds it", async () => {
				expect(await failingOf("src/game/Buy.client.luau")).toEqual([
					["tree.deadScript", "src/game/Buy.client.luau"],
				]);
			});

			it("should check a shared file by every config that holds it, and report it once", async () => {
				expect(await failingOf("src/common/Stray.client.luau")).toEqual(
					[["tree.deadScript", "src/common/Stray.client.luau"]]
				);
			});

			it.each(["src/common/New.client.luau", "src/game/New.client.luau"])(
				"should check %s, which does not exist yet",
				async (asked) => {
					expect(await failingOf(asked)).toEqual([
						["tree.deadScript", asked],
					]);
				}
			);

			it("should skip a file that no config holds, and pass", async () => {
				await write("tools/Stray.client.luau");

				const found = (
					await askIn(abs(), "tools/Stray.client.luau")
				).unwrap();

				expect(found.failing).toEqual([]);
				expect(found.skipped).toHaveLength(1);
			});

			it("should check a folder by every config that holds some of it", async () => {
				expect(await filesOf("src")).toEqual(
					new Set([
						"src/common/Stray.client.luau",
						"src/game/Buy.client.luau",
					])
				);
			});

			it("should leave a nearer default config to answer, as for any file", async () => {
				await writeConfig("src/lobby/default.rogen.json", {
					sourcePaths: ["."],
					routes: ROUTES,
				});
				await write("src/lobby/Sell.client.luau");

				expect(await failingOf("src/lobby/Sell.client.luau")).toEqual([
					["tree.deadScript", "src/lobby/Sell.client.luau"],
				]);
			});

			it("should check a config named by its bare name whole", async () => {
				expect(await failingOf("game")).toEqual(
					await failingOf("game.rogen.json")
				);
				expect(await filesOf("game")).toEqual(
					new Set([
						"src/common/Stray.client.luau",
						"src/game/Buy.client.luau",
					])
				);
			});

			it("should check a bare name that stands for a project file", async () => {
				await fs.writeFile(abs("arena.project.json"), "{}");

				const found = (await askIn(abs(), "arena")).unwrap();

				expect(codesOf(found.failing)).toEqual([
					"config.unnamedProjectFile",
				]);
				expect(found.skipped).toEqual([]);
			});

			it("should read a bare name that is a folder with a default as the write does", async () => {
				await writeConfig("dist.rogen.json", {
					name: "dist",
					routes: ROUTES,
				});
				await writeConfig("dist/default.rogen.json", {
					routes: ROUTES,
				});
				await write("dist/src/Stray.client.luau");

				expect(await failingOf("dist")).toEqual([
					["tree.deadScript", "dist/src/Stray.client.luau"],
				]);
			});

			describe("bare, in a folder of several configs", () => {
				const clean = async () => {
					await fs.delete(abs("src/common/Stray.client.luau"));
					await fs.delete(abs("src/game/Buy.client.luau"));
				};

				it("should check every config of the folder", async () => {
					expect(await filesOf()).toEqual(
						new Set([
							"src/common/Stray.client.luau",
							"src/game/Buy.client.luau",
						])
					);
				});

				it("should fail on a config that does not load beside configs that do", async () => {
					await clean();
					await fs.writeFile(abs("release.rogen.json"), "{ nope");

					expect(
						new Set((await failingOf()).map(([code]) => code))
					).toEqual(new Set(["config.invalidSyntax"]));
				});

				it("should pass when every config is clean", async () => {
					await clean();

					expect(await failingOf()).toEqual([]);
				});

				it("should report the stale project file of a config that is not the first", async () => {
					await clean();
					await fs.writeFile(abs("lobby.project.json"), "{}");

					expect(await failingOf()).toEqual([
						["output.differs", "lobby.project.json"],
					]);
				});
			});
		});
	});
});
