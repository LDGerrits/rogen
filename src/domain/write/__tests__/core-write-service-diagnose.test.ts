import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
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
			await writeServiceOf(fs, new CoreIndexService(fs)).diagnose({
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
			writeServiceOf(fs, new CoreIndexService(fs)).diagnose({
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
});
