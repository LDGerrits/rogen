import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfigSpec } from "../../config/__tests__/mock-config-service.js";
import { abs, routeFiles, writeFiles } from "./fixtures.js";

describe("Router", () => {
	describe("route", () => {
		let fs: MemoryFileSystemService;

		const write = (...paths: string[]) => writeFiles(fs, ...paths);

		const route = (
			overrides: ResolvedConfigSpec = {},
			rootDirs: readonly string[] = [abs("src")]
		) => routeFiles(fs, overrides, rootDirs);

		const paths = async (
			overrides: ResolvedConfigSpec = {},
			rootDirs?: readonly string[]
		) =>
			(await route(overrides, rootDirs))
				.unwrap()
				.routed.map((file) => file.instancePath.join("/"));

		beforeEach(() => {
			fs = new MemoryFileSystemService();
		});

		describe("variants", () => {
			const variantsOf = async (
				overrides: ResolvedConfigSpec = { variants: { mock: true } }
			) =>
				(await route(overrides))
					.unwrap()
					.routed.map((file) => file.variants);

			it("should keep the name of a Name.variant folder, and prune under it when the variant is off", async () => {
				await write(
					"src/Analytics.mock/Service.luau",
					"src/.mock/Probe.luau"
				);

				expect(await paths({ variants: { mock: true } })).toEqual([
					"ReplicatedStorage/shared/Probe",
					"ReplicatedStorage/shared/Analytics/Service",
				]);
				expect(await paths({ variants: { mock: false } })).toEqual([
					"ReplicatedStorage/shared/Probe",
					"ReplicatedStorage/shared/Analytics/Service",
				]);
				expect(
					(await route({ variants: { mock: false } })).unwrap().files
				).toEqual([]);
			});

			it("should route and vary a folder named with both, and take a route that restates an outer one off its name", async () => {
				await write(
					"src/Net.mock@server/Remote.luau",
					"src/client/Hud.mock@client/Bar.luau"
				);

				expect(
					(await route({ variants: { mock: true } }))
						.unwrap()
						.files.map((file) => file.instancePath.join("/"))
				).toEqual([
					"ServerScriptService/Net/Remote",
					"StarterPlayer/StarterPlayerScripts/Hud/Bar",
				]);
			});

			it("should apply every key of a folder named by keys alone, in either order, and leave no folder", async () => {
				await write(
					"src/D/.mock@server/A.luau",
					"src/E/@server.mock/B.luau",
					"src/F/.mock.dev/C.luau",
					"src/G/mock@server/D.luau"
				);
				const placed = async (variants: Record<string, boolean>) =>
					(await route({ variants }))
						.unwrap()
						.files.map((file) => file.instancePath.join("/"));

				expect(await placed({ mock: true, dev: true })).toEqual([
					"ServerScriptService/D/A",
					"ServerScriptService/E/B",
					"ReplicatedStorage/shared/F/C",
					"ServerScriptService/G/mock/D",
				]);
				expect(await placed({ mock: false, dev: true })).toEqual([
					"ServerScriptService/G/mock/D",
				]);
			});

			it("should leave no folder for a key-only folder that restates its route, and hoist one that takes a ^", async () => {
				await write(
					"src/server/.mock@server/A.luau",
					"src/Feature/^.mock@server/B.luau",
					"src/Other/(.mock@server)/C.luau"
				);

				const result = (
					await route({ variants: { mock: true } })
				).unwrap();

				expect(
					result.files.map((file) => file.instancePath.join("/"))
				).toEqual([
					"ServerScriptService/B",
					"ServerScriptService/Other/C",
					"ServerScriptService/A",
				]);
				expect(result.warnings).toEqual([]);
			});

			it("should refuse a key-only folder whose route an outer route outranks", async () => {
				await write("src/server/.mock@client/A.luau");

				const result = await route({ variants: { mock: true } });

				expect(
					result.isErr() &&
						result.error.diagnostics.map(({ code, resource }) => [
							code,
							resource,
						])
				).toEqual([
					["route.ignoredAt", abs("src/server/.mock@client")],
				]);
			});

			it("should make an init script in a key-only folder the folder above, and refuse one with no folder above", async () => {
				await write("src/Net/.mock@server/init.luau");

				expect(await paths({ variants: { mock: true } })).toEqual([
					"ServerScriptService/Net",
				]);

				await write("src/.mock@server/init.luau");
				const result = await route({ variants: { mock: true } });

				expect(
					result.isErr() &&
						result.error.diagnostics.map(({ code }) => code)
				).toEqual(["tree.initWithoutFolder"]);
			});

			it("should remove a variant folder from the path", async () => {
				await write("src/Analytics/mock/Service.luau");

				const [file] = (
					await route({ variants: { mock: true } })
				).unwrap().routed;

				expect(file.instancePath).toEqual([
					"ReplicatedStorage",
					"shared",
					"Analytics",
					"Service",
				]);
				expect(file.variants).toEqual([
					{ variant: "mock", form: "folder" },
				]);
			});

			it("should keep a folder that a variant marker applies to", async () => {
				await write(
					"src/Experimental/.mock",
					"src/Experimental/Save.luau"
				);

				const [file] = (
					await route({ variants: { mock: true } })
				).unwrap().routed;

				expect(file.instancePath).toEqual([
					"ReplicatedStorage",
					"shared",
					"Experimental",
					"Save",
				]);
				expect(file.variants).toEqual([
					{ variant: "mock", form: "marker" },
				]);
			});

			it("should apply a marker in the root dir to every file", async () => {
				await write("src/.mock", "src/A/B.luau");

				expect(await variantsOf()).toEqual([
					[{ variant: "mock", form: "marker" }],
				]);
			});

			it("should record how a suffix matched", async () => {
				await write("src/Analytics.mock.luau", "src/HttpMock.luau");

				expect(await variantsOf()).toEqual([
					[{ variant: "mock", form: "suffix" }],
					[],
				]);
			});

			it("should record a variant on a script's init file", async () => {
				await write("src/Combat/init.mock.luau");

				expect(await variantsOf()).toEqual([
					[{ variant: "mock", form: "suffix" }],
				]);
			});

			it("should record every variant a file carries", async () => {
				await write("src/dev/Save.mock.luau");

				expect(
					await variantsOf({ variants: { mock: true, dev: true } })
				).toEqual([
					[
						{ variant: "dev", form: "folder" },
						{ variant: "mock", form: "suffix" },
					],
				]);
			});

			it("should not record a dot-file or folder that is not a declared variant", async () => {
				await write("src/.beta", "src/beta/Save.luau");

				expect(await variantsOf()).toEqual([[]]);
			});

			it("should report a .server that a variant suffix follows", async () => {
				await write(
					"src/Foo.server.mock.luau",
					"src/Bar.mock.server.luau"
				);

				const { placement, routed } = (
					await route({ variants: { mock: true } })
				).unwrap();

				expect(
					routed.map(
						(file) => placement.readingOf(file).buriedScriptSuffix
					)
				).toEqual([undefined, "server"]);
			});
		});

		describe("a variant that lands elsewhere", () => {
			const elsewhere = async (mock: boolean) => {
				const result = await route({ variants: { mock } });
				return result.isErr()
					? result.error.diagnostics
							.filter(
								({ code }) => code === "variant.landsElsewhere"
							)
							.map(({ resource }) => resource)
					: [];
			};

			it.each([true, false])(
				"should refuse a variant that a route suffix, a marker or a ^ lands apart from the plain file beside it (mock: %s)",
				async (mock) => {
					await write(
						"src/Analytics.luau",
						"src/Analytics.mock@server.luau",
						"src/A/Service.luau",
						"src/A/mock/@server",
						"src/A/mock/Service.luau",
						"src/B/Hud.luau",
						"src/B/^Hud.mock.luau",
						"src/Net/init.luau",
						"src/Net/Remote.luau",
						"src/Net/mock/@client",
						"src/Net/mock/init.luau"
					);

					expect(await elsewhere(mock)).toEqual([
						abs("src/A/mock/Service.luau"),
						abs("src/Analytics.mock@server.luau"),
						abs("src/B/^Hud.mock.luau"),
						abs("src/Net/mock/init.luau"),
					]);
				}
			);

			it("should say where each lands and how to fix it", async () => {
				await write(
					"src/Analytics.luau",
					"src/Analytics.mock@server.luau"
				);

				const result = await route({ variants: { mock: true } });

				expect(
					result.isErr() && result.error.diagnostics[0].message
				).toBe(
					`lands at "ServerScriptService/Analytics", but ${abs("src/Analytics.luau")}, which it is a variant of, lands at "ReplicatedStorage/shared/Analytics", so both would ship. Route and hoist them the same way.`
				);
			});

			it("should leave a clash in a folder above it, or an @ an outer route ignores, to that error", async () => {
				await write(
					"src/A/Service.luau",
					"src/A/mock/@server",
					"src/A/mock/@client",
					"src/A/mock/dev/Service.luau",
					"src/server/Save@client.luau",
					"src/server/Save.mock.luau"
				);

				const result = await route({
					variants: { mock: true, dev: true },
				});

				expect(
					result.isErr() &&
						result.error.diagnostics.map(({ code, resource }) => [
							code,
							resource,
						])
				).toEqual([
					["route.markerClash", abs("src/A/mock")],
					["route.ignoredAt", abs("src/server/Save@client.luau")],
				]);
			});

			it("should accept a variant beside plain files when it lands with one of them, or with nothing beside it", async () => {
				await write(
					"src/Types.luau",
					"src/Types@server.luau",
					"src/Types.mock.luau",
					"src/A/X.luau",
					"src/A/server/X.mock.luau",
					"src/C/Probe.mock@server.luau",
					"src/Analytics.mock/Service.luau",
					"src/Analytics/Service.luau",
					"src/D/(Internals)/Foo.mock.luau",
					"src/D/Internals/Foo.luau",
					"src/E/^Net/Http.mock.luau",
					"src/E/Net/Http.luau"
				);

				expect(await elsewhere(true)).toEqual([]);
				expect((await route({ variants: { mock: true } })).isOk()).toBe(
					true
				);
			});
		});
	});
});
