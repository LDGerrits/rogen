import { DisposableStore } from "../../../base/disposable.js";
import { toPosix } from "../../../base/path.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { SyncLayout } from "../sync-layout.js";
import { BuildTemplate } from "../build-template.js";
import {
	abs,
	buildAndPlace,
	configOf,
	placedLines,
	syncTools,
	writeFiles,
} from "./fixtures.js";

const ROUTES = {
	server: "ServerScriptService",
	"*": "ReplicatedStorage",
};

describe("modes in a build", () => {
	let fs: MemoryFileSystemService;
	let store: DisposableStore;

	const write = (...paths: string[]) => writeFiles(fs, ...paths);

	const built = async (spec: Parameters<typeof configOf>[0]) =>
		(
			await buildAndPlace(
				store,
				fs,
				configOf({ routes: ROUTES, ...spec })
			)
		).unwrap();

	const MODES = { dev: {}, prod: {} };

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		store = new DisposableStore();
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	describe("marking files", () => {
		it("should place the active mode's suffix file under the plain name and prune the other mode's", async () => {
			await write("src/Service.dev.luau", "src/Service.prod.luau");

			const { placement } = await built({ modes: MODES, mode: "prod" });

			expect(placedLines(placement.files)).toEqual([
				"Service.prod.luau -> ReplicatedStorage/Service",
			]);
			expect(
				placement.leftOut.get(abs("src/Service.dev.luau"))
			).toMatchObject({
				status: "pruned",
				variants: [{ variant: "dev", form: "suffix" }],
			});
		});

		it("should let the active mode's file replace the plain one", async () => {
			await write("src/Service.luau", "src/Service.prod.luau");

			const { placement } = await built({ modes: MODES, mode: "prod" });

			expect(placedLines(placement.files)).toEqual([
				"Service.prod.luau -> ReplicatedStorage/Service",
			]);
			expect(placement.leftOut.get(abs("src/Service.luau"))).toEqual({
				status: "replaced",
				by: abs("src/Service.prod.luau"),
			});
		});

		it("should move an active mode folder's files up and prune another mode's whole", async () => {
			await write("src/dev/A.luau", "src/prod/B.luau");

			const { placement } = await built({ modes: MODES, mode: "dev" });

			expect(placedLines(placement.files)).toEqual([
				"dev/A.luau -> ReplicatedStorage/A",
			]);
			expect(placement.leftOut.get(abs("src/prod/B.luau"))).toMatchObject(
				{
					status: "pruned",
					variants: [{ variant: "prod", form: "folder" }],
				}
			);
		});

		it("should read a marker file for a mode as it reads one for a variant", async () => {
			await write("src/Net/.prod", "src/Net/A.luau", "src/Lib/B.luau");

			const { placement } = await built({ modes: MODES, mode: "dev" });

			expect(placedLines(placement.files)).toEqual([
				"Lib/B.luau -> ReplicatedStorage/Lib/B",
			]);
			expect(placement.leftOut.get(abs("src/Net/A.luau"))).toMatchObject({
				status: "pruned",
				variants: [{ variant: "prod", form: "marker" }],
			});
		});

		it("should keep a mode's file out of a config that declares no modes", async () => {
			await write("src/Service.prod.luau");

			const { placement } = await built({});

			expect(placedLines(placement.files)).toEqual([
				"Service.prod.luau -> ReplicatedStorage/Service.prod",
			]);
		});

		it("should count the files each mode carries in the summary", async () => {
			await write(
				"src/A.dev.luau",
				"src/B.dev.luau",
				"src/C.prod.luau",
				"src/D.luau"
			);

			const { summary } = await built({ modes: MODES, mode: "dev" });

			expect(summary.modes).toEqual([
				{ mode: "dev", on: true, files: 2 },
				{ mode: "prod", on: false, files: 1 },
			]);
		});

		it("should leave a mode's name out of the summary's variants", async () => {
			await write("src/A.dev.luau");

			const { summary } = await built({
				modes: { dev: { variants: { mock: true } } },
				variants: { mock: false },
			});

			expect(summary.variants.map(({ variant }) => variant)).toEqual([
				"mock",
			]);
		});
	});

	describe("excluding", () => {
		it("should leave out what the active mode's exclude matches", async () => {
			await write("src/A.luau", "src/A.spec.luau");

			const { placement } = await built({
				modes: {
					dev: {},
					prod: { exclude: [toPosix(abs("**/*.spec.luau"))] },
				},
				mode: "prod",
			});

			expect(placedLines(placement.files)).toEqual([
				"A.luau -> ReplicatedStorage/A",
			]);
			expect(placement.leftOut.get(abs("src/A.spec.luau"))).toMatchObject(
				{
					status: "excluded",
				}
			);
		});

		it("should build specs in the mode that does not exclude them", async () => {
			await write("src/A.luau", "src/A.spec.luau");

			const { placement } = await built({
				modes: {
					dev: {},
					prod: { exclude: [toPosix(abs("**/*.spec.luau"))] },
				},
				mode: "dev",
			});

			expect(placedLines(placement.files)).toEqual([
				"A.luau -> ReplicatedStorage/A",
				"A.spec.luau -> ReplicatedStorage/A.spec",
			]);
		});
	});

	describe("template nodes", () => {
		const templateOf = (mode: string) => {
			const config = configOf({
				modes: {
					dev: {},
					prod: { exclude: [toPosix(abs("DevPackages"))] },
				},
				mode,
				template: {
					file: abs("template.project.json"),
					project: {
						name: "game",
						tree: {
							$className: "DataModel",
							ReplicatedStorage: {
								DevPackages: { $path: "DevPackages" },
								Packages: { $path: "Packages" },
							},
						},
					},
				},
			});
			return new BuildTemplate(config, new SyncLayout(config, syncTools));
		};

		it("should drop a mounted node whose $path the active mode excludes", () => {
			const template = templateOf("prod");

			expect(
				template.getNode(["ReplicatedStorage", "DevPackages"])
			).toBeUndefined();
			expect(
				template.getNode(["ReplicatedStorage", "Packages"])
			).toMatchObject({ $path: "Packages" });
			expect(template.mounts.paths).toEqual([abs("Packages")]);
		});

		it("should keep the node in the mode that does not exclude it", () => {
			const template = templateOf("dev");

			expect(
				template.getNode(["ReplicatedStorage", "DevPackages"])
			).toMatchObject({ $path: "DevPackages" });
			expect(template.mounts.paths).toEqual([
				abs("DevPackages"),
				abs("Packages"),
			]);
		});
	});

	describe("checking every mode", () => {
		const warningsOf = async (spec: Parameters<typeof configOf>[0]) =>
			(await built(spec)).findings.warnings;

		it("should warn in the active mode when no file gives an instance, naming the mode", async () => {
			await write("src/Net.dev.luau", "src/Net.staging.luau");

			const warnings = await warningsOf({
				modes: { dev: {}, staging: {}, prod: {} },
				mode: "prod",
			});

			expect(warnings).toMatchObject([
				{
					code: "mode.missingInstance",
					message: expect.stringContaining(
						'in mode "prod", 1 instance is missing'
					),
				},
			]);
			expect(warnings[0].message).toContain(
				"ReplicatedStorage/Net (dev, staging)"
			);
		});

		it("should warn from a dev build that prod would lose an instance", async () => {
			await write("src/Net.dev.luau", "src/Net.staging.luau");

			const warnings = await warningsOf({
				modes: { dev: {}, staging: {}, prod: {} },
				mode: "dev",
			});

			expect(warnings.map(({ code }) => code)).toEqual([
				"mode.missingInstance",
			]);
			expect(warnings[0].message).toContain('in mode "prod"');
		});

		it("should stay silent about a file only one mode has", async () => {
			await write("src/DebugPanel.dev.luau");

			expect(await warningsOf({ modes: MODES, mode: "prod" })).toEqual(
				[]
			);
		});

		it("should stay silent when each mode has its own file", async () => {
			await write("src/Net.dev.luau", "src/Net.prod.luau");

			expect(await warningsOf({ modes: MODES, mode: "dev" })).toEqual([]);
		});

		it("should stay silent when a plain file gives the instance in every mode", async () => {
			await write(
				"src/Net.luau",
				"src/Net.dev.luau",
				"src/Net.staging.luau"
			);

			expect(
				await warningsOf({
					modes: { dev: {}, staging: {}, prod: {} },
					mode: "dev",
				})
			).toEqual([]);
		});

		it("should warn that two files clash in a mode the build is not in", async () => {
			await write("src/Net.prod.luau", "src/prod/Net.luau");

			const warnings = await warningsOf({ modes: MODES, mode: "dev" });

			expect(warnings).toMatchObject([
				{
					code: "mode.clash",
					message: expect.stringContaining('(in mode "prod")'),
				},
				{ code: "mode.clash" },
			]);
		});

		it("should check the mode's own variants, not the active mode's", async () => {
			await write("src/Analytics.mock.luau", "src/Analytics.fake.luau");

			const warnings = await warningsOf({
				variants: { mock: false, fake: false },
				modes: {
					dev: { variants: { mock: true } },
					prod: {},
				},
				mode: "dev",
			});

			expect(warnings.map(({ code }) => code)).toEqual([
				"mode.missingInstance",
			]);
			expect(warnings[0].message).toContain('in mode "prod"');
		});

		it("should not repeat in another mode a gap the active mode reports", async () => {
			await write("src/Analytics.mock.luau", "src/Analytics.fake.luau");

			const warnings = await warningsOf({
				variants: { mock: false, fake: false },
				modes: MODES,
				mode: "dev",
			});

			expect(warnings.map(({ code }) => code)).toEqual([
				"variant.noneActive",
			]);
		});

		it("should warn nothing for a config without modes", async () => {
			await write("src/A.luau");

			expect(await warningsOf({})).toEqual([]);
		});
	});
});
