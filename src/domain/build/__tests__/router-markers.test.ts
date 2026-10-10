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

		describe("marker files", () => {
			it("should route a folder and everything below it, keeping the folder name", async () => {
				await write(
					"src/Inventory/@server",
					"src/Inventory/Save.luau",
					"src/Inventory/deep/Load.luau"
				);

				expect(await paths()).toEqual([
					"ServerScriptService/Inventory/Save",
					"ServerScriptService/Inventory/deep/Load",
				]);
			});

			it("should route everything under a marker in the root dir", async () => {
				await write("src/@server", "src/Save.luau");

				expect(await paths()).toEqual(["ServerScriptService/Save"]);
			});

			it("should let an outer marker beat a nested marker that restates it", async () => {
				await write(
					"src/Inventory/@server",
					"src/Inventory/inner/@server",
					"src/Inventory/inner/Hud.luau"
				);

				expect(await paths()).toEqual([
					"ServerScriptService/Inventory/inner/Hud",
				]);
			});

			it("should refuse two markers that route one folder differently, an init script's suffix among them", async () => {
				await write(
					"src/C/@server",
					"src/C/@client",
					"src/C/X.luau",
					"src/D/@server",
					"src/D/init@client.luau"
				);

				const result = await route();

				expect(
					result.isErr() &&
						result.error.diagnostics.map(
							({ code, resource, message }) => [
								code,
								resource,
								message,
							]
						)
				).toEqual([
					[
						"route.markerClash",
						abs("src/C"),
						'"@client" and "@server" route this folder to different places, and nothing decides between them. Keep one.',
					],
					[
						"route.markerClash",
						abs("src/D"),
						'"@server" and "init@client.luau" route this folder to different places, and nothing decides between them. Keep one.',
					],
				]);
			});

			it("should let markers that agree and variant markers stand together", async () => {
				await write(
					"src/C/@server",
					"src/C/init@server.luau",
					"src/C/.mock",
					"src/C/.dev",
					"src/C/X.luau",
					"src/E/@server",
					"src/E/@Server",
					"src/E/Z.luau"
				);

				const result = (
					await route({
						variants: { mock: true, dev: true },
					})
				).unwrap();

				expect(
					result.files.map((file) => file.instancePath.join("/"))
				).toEqual([
					"ServerScriptService/C/X",
					"ServerScriptService/C",
					"ServerScriptService/E/Z",
				]);
				expect(result.warnings).toEqual([]);
			});

			it.each([true, false])(
				"should refuse init scripts whose variants route their folder differently, with the variant on or off (mock: %s)",
				async (mock) => {
					await write(
						"src/C/init@server.luau",
						"src/C/init.mock@client.luau",
						"src/C/X.luau"
					);

					const result = await route({ variants: { mock } });

					expect(
						result.isErr() &&
							result.error.diagnostics.map(
								({ code, resource }) => [code, resource]
							)
					).toEqual([["route.markerClash", abs("src/C")]]);
				}
			);

			it("should point init scripts of variants that are never on together at a folder beside theirs for each", async () => {
				await write(
					"src/C/init.dev@server.luau",
					"src/C/init.prod@client.luau",
					"src/C/X.luau"
				);

				const result = await route({
					variants: { dev: true, prod: false },
					conflicts: [["dev", "prod"]],
				});

				expect(
					result.isErr() &&
						result.error.diagnostics.map(({ code, message }) => [
							code,
							message,
						])
				).toEqual([
					[
						"route.markerClash",
						'"init.dev@server.luau" and "init.prod@client.luau" route this folder to different places, but a variant never changes where a file lands. Move the files only a variant sends elsewhere into a folder beside this one: C.dev@server/ and C.prod@client/.',
					],
				]);
			});

			it("should name the folder beside it that each set of variants needs, and keep the plain message when the clash isn't a variant's", async () => {
				await write(
					"src/C/@server",
					"src/C/init.mock@server.luau",
					"src/C/init.dev@client.luau",
					"src/D/@server",
					"src/D/@client",
					"src/D/init.mock@server.luau",
					"src/E/init.dev@server.luau",
					"src/E/init.dev@client.luau",
					"src/F/@server",
					"src/F/init.mock.dev@client.luau",
					"src/G/@server",
					"src/G/init.dev@client.luau",
					"src/G/init.prod@ReplicatedFirst.luau",
					"src/H/@server",
					"src/H/init.mock.dev@client.luau",
					"src/H/init.dev.mock@ReplicatedFirst.luau",
					"src/I.mock/@server",
					"src/I.mock/init.dev@client.luau",
					"src/server/J/init.dev@client.luau",
					"src/server/J/init.prod@ReplicatedFirst.luau",
					"src/K@server/@server",
					"src/K@server/init.dev@client.luau"
				);

				const result = await route({
					variants: { mock: true, dev: true, prod: false },
				});

				expect(
					result.isErr() &&
						result.error.diagnostics
							.filter(({ code }) => code === "route.markerClash")
							.map(({ resource, message }) => [
								resource,
								message.slice(message.indexOf(" places") + 7),
							])
				).toEqual([
					[
						abs("src/C"),
						", but a variant never changes where a file lands. Move the files only a variant sends elsewhere into a folder beside this one: C.dev@client/.",
					],
					[
						abs("src/D"),
						", and nothing decides between them. Keep one.",
					],
					[
						abs("src/F"),
						", but a variant never changes where a file lands. Move the files only a variant sends elsewhere into a folder beside this one: F.dev.mock@client/.",
					],
					[
						abs("src/G"),
						", but a variant never changes where a file lands. Move the files only a variant sends elsewhere into a folder beside this one: G.dev@client/ and G.prod@ReplicatedFirst/.",
					],
					[
						abs("src/H"),
						", and nothing decides between them. Keep one.",
					],
					[
						abs("src/I.mock"),
						", but a variant never changes where a file lands. Move the files only a variant sends elsewhere into a folder beside this one.",
					],
					[
						abs("src/K@server"),
						", and nothing decides between them. Keep one.",
					],
					[
						abs("src/E"),
						", and nothing decides between them. Keep one.",
					],
					[
						abs("src/server/J"),
						", and nothing decides between them. Keep one.",
					],
				]);
			});

			it("should keep the plain message when a marker in a folder above governs the clash", async () => {
				await write(
					"src/L/@server",
					"src/L/Sub/init.dev@client.luau",
					"src/L/Sub/init.prod@ReplicatedFirst.luau"
				);

				const result = await route({
					variants: { dev: true, prod: false },
				});

				expect(
					result.isErr() &&
						result.error.diagnostics
							.filter(({ code }) => code === "route.markerClash")
							.map(({ resource, message }) => [
								resource,
								message.slice(message.indexOf(" places") + 7),
							])
				).toEqual([
					[
						abs("src/L/Sub"),
						", and nothing decides between them. Keep one.",
					],
				]);
			});

			it("should keep the plain message for init scripts of variants that clash in a root dir", async () => {
				await write(
					"src/@server",
					"src/init.dev@client.luau",
					"src/X.luau"
				);

				const result = await route({ variants: { dev: true } });

				expect(
					result.isErr() &&
						result.error.diagnostics
							.filter(({ code }) => code === "route.markerClash")
							.map(({ message }) => message)
				).toEqual([
					'"@server" and "init.dev@client.luau" route this folder to different places, and nothing decides between them. Keep one.',
				]);
			});

			it("should route an init script's folder by its last @key alone, so two in its name aren't a clash", async () => {
				await write("src/I/init@client@server.luau", "src/I/X.luau");

				const result = await route();

				expect(
					result.isErr() &&
						result.error.diagnostics.map(({ code, resource }) => [
							code,
							resource,
						])
				).toEqual([
					["route.ignoredAt", abs("src/I/init@client@server.luau")],
				]);
			});

			it("should ignore dot-files that aren't declared routes", async () => {
				await write("src/.gitkeep", "src/.mock", "src/Save.luau");

				expect(await paths()).toEqual([
					"ReplicatedStorage/shared/Save",
				]);
			});
		});

		describe("an @ an outer route outranks", () => {
			const errors = async (overrides: ResolvedConfigSpec = {}) => {
				const result = await route(overrides);
				return result.isErr()
					? result.error.diagnostics.map(({ code, resource }) => [
							code,
							resource,
						])
					: [];
			};

			it("should refuse it once per file or folder that spells it, on a suffix, a folder, a marker and an init script", async () => {
				await write(
					"src/server/Util@client.luau",
					"src/server/Ui@client/Hud.luau",
					"src/server/Ui@client/Bar.luau",
					"src/server/@client/Probe.luau",
					"src/server/Net/@client",
					"src/server/Net/Remote.luau",
					"src/server/Store/init@client.luau",
					"src/ReplicatedFirst/Queue@client/main.luau"
				);

				expect(await errors()).toEqual([
					[
						"route.ignoredAt",
						abs("src/ReplicatedFirst/Queue@client"),
					],
					["route.ignoredAt", abs("src/server/@client")],
					["route.ignoredAt", abs("src/server/Net/@client")],
					[
						"route.ignoredAt",
						abs("src/server/Store/init@client.luau"),
					],
					["route.ignoredAt", abs("src/server/Ui@client")],
					["route.ignoredAt", abs("src/server/Util@client.luau")],
				]);
			});

			it("should refuse it on a file whose variant is off", async () => {
				await write(
					"src/server/Util.mock@client.luau",
					"src/server/Util.luau"
				);

				expect(await errors({ variants: { mock: false } })).toEqual([
					[
						"route.ignoredAt",
						abs("src/server/Util.mock@client.luau"),
					],
				]);
			});

			it("should refuse a route before another in one name, on a folder as on a file, bare or not", async () => {
				await write(
					"src/Net@client@server/A.luau",
					"src/@client@server/B.luau",
					"src/Foo@client@server.luau",
					"src/@client@server.luau"
				);

				expect(await errors()).toEqual([
					["route.ignoredAt", abs("src/@client@server")],
					["route.ignoredAt", abs("src/@client@server.luau")],
					["route.ignoredAt", abs("src/Foo@client@server.luau")],
					["route.ignoredAt", abs("src/Net@client@server")],
				]);
			});

			it("should name the route that governs and both fixes", async () => {
				await write(
					"src/server/Util@client.luau",
					"src/server/Ui@client/Hud.luau",
					"src/server/Net/@client",
					"src/server/Net/Remote.luau"
				);

				const result = await route();

				expect(
					result.isErr() &&
						result.error.diagnostics.map(({ message }) => message)
				).toEqual([
					'"@client" does nothing here, because the "server" route already governs this folder. Remove it, or move the folder out of the "server" route\'s files.',
					'"@client" does nothing here, because the "server" route already governs this folder. Remove it, or move the folder out of the "server" route\'s files.',
					'"@client" does nothing here, because the "server" route already governs this file. Remove it, or move the file out of the "server" route\'s files.',
				]);
			});

			it("should name every outranked key a name spells in one error", async () => {
				await write(
					"src/server/Util@client@ReplicatedFirst.luau",
					"src/server/Net@client@ReplicatedFirst/A.luau"
				);

				const result = await route();

				expect(
					result.isErr() &&
						result.error.diagnostics.map(
							({ resource, message }) => [resource, message]
						)
				).toEqual([
					[
						abs("src/server/Net@client@ReplicatedFirst"),
						'"@ReplicatedFirst" and "@client" do nothing here, because the "server" route already governs this folder. Remove them, or move the folder out of the "server" route\'s files.',
					],
					[
						abs("src/server/Util@client@ReplicatedFirst.luau"),
						'"@ReplicatedFirst" and "@client" do nothing here, because the "server" route already governs this file. Remove them, or move the file out of the "server" route\'s files.',
					],
				]);
			});

			it("should report it beside a marker clash, leaving the clashing markers to that error", async () => {
				await write(
					"src/server/Util@client.luau",
					"src/C/@server",
					"src/C/@client",
					"src/C/X.luau"
				);

				expect(await errors()).toEqual([
					["route.markerClash", abs("src/C")],
					["route.ignoredAt", abs("src/server/Util@client.luau")],
				]);
			});

			it("should not report a file the template displaces", async () => {
				await write(
					"src/server/Net/@client",
					"src/server/Net/Remote.luau"
				);

				expect(
					await errors({
						template: {
							file: abs("template.project.json"),
							project: {
								name: "game",
								tree: {
									$className: "DataModel",
									ServerScriptService: {
										Net: { $path: "vendor/Net" },
									},
								},
							},
						},
					})
				).toEqual([]);
			});

			it("should take an @ that restates the governing route at any depth as that route, silently", async () => {
				await write(
					"src/client/Net/Remote@client.luau",
					"src/client/Ui@client/Hud.luau",
					"src/client/Bar/@client",
					"src/client/Bar/Health.luau",
					"src/client/Store/init@client.luau",
					"src/client/Store/Cart.luau",
					"src/client/@client/Probe.luau",
					"src/Net@server/@server",
					"src/Net@server/Remote.luau"
				);

				const result = (await route()).unwrap();

				expect(
					result.files.map((file) => file.instancePath.join("/"))
				).toEqual([
					"ServerScriptService/Net/Remote",
					"StarterPlayer/StarterPlayerScripts/Probe",
					"StarterPlayer/StarterPlayerScripts/Bar/Health",
					"StarterPlayer/StarterPlayerScripts/Net/Remote",
					"StarterPlayer/StarterPlayerScripts/Store/Cart",
					"StarterPlayer/StarterPlayerScripts/Store",
					"StarterPlayer/StarterPlayerScripts/Ui/Hud",
				]);
				expect(result.warnings).toEqual([]);
			});

			it("should keep a bare folder named after an outranked route as an ordinary folder, silently", async () => {
				await write("src/server/client/Bar.luau");

				const result = (await route()).unwrap();

				expect(
					result.files.map((file) => file.instancePath.join("/"))
				).toEqual(["ServerScriptService/client/Bar"]);
				expect(result.warnings).toEqual([]);
			});
		});
	});
});
