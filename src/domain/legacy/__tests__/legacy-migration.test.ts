import path from "path";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MigratedProject } from "../../init/project-migration.js";
import { LegacyMigration } from "../legacy-migration.js";

const ROOT = path.resolve("/repo");

describe("LegacyMigration", () => {
	let fs: MemoryFileSystemService;

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory(ROOT);
	});

	const write = (file: string, content = "return {}") =>
		fs.writeFile(path.join(ROOT, file), content);

	const writeConfig = (config: object, file = ".rogen.json") =>
		write(file, JSON.stringify(config));

	const migrate = async (): Promise<MigratedProject> => {
		const found = (await new LegacyMigration().find(ROOT, fs)).unwrap();
		if (!found) throw new Error("found no v1 config");
		return found;
	};

	const configOf = async (fileName = "default.rogen.json") =>
		(await migrate()).configs.find((config) => config.fileName === fileName)
			?.config;

	const renamesOf = async () =>
		(await migrate()).moves.filter(
			({ from }) => !from.endsWith(".rogen.json")
		);

	const codesOf = async () =>
		(await migrate()).warnings.map(({ code }) => code);

	describe("find", () => {
		it("should find nothing in a folder without a v1 config", async () => {
			await write("default.rogen.json", '{ "sourcePaths": ["src"] }');

			expect((await new LegacyMigration().find(ROOT, fs)).unwrap()).toBe(
				undefined
			);
		});

		it("should set every v1 config aside, beside where it was", async () => {
			await writeConfig({ source: "src" });
			await writeConfig({ source: "lobby" }, "lobby.rogen.json");

			const found = await migrate();

			expect(found.from).toEqual([".rogen.json", "lobby.rogen.json"]);
			expect(found.moves.slice(0, 2)).toEqual([
				{ from: ".rogen.json", to: ".rogen.json.v1" },
				{ from: "lobby.rogen.json", to: "lobby.rogen.json.v1" },
			]);
		});

		it("should fail when the project file the config names can't be read", async () => {
			await writeConfig({ source: "src", project: "base.json" });

			const found = await new LegacyMigration().find(ROOT, fs);

			expect(found.isErr() && found.error).toMatchObject([
				{ code: "legacy.projectUnreadable" },
			]);
		});
	});

	describe("the config", () => {
		it("should take the source paths and the project, but not the project file v1 wrote", async () => {
			await write(
				"default.project.json",
				'{ "name": "old", "tree": { "ReplicatedStorage": { "$path": "src" } } }'
			);
			await writeConfig({
				source: ["src", "lib"],
				project: {
					name: "game",
					servePort: 34873,
					tree: {
						$className: "DataModel",
						ReplicatedStorage: { Packages: { $path: "Packages" } },
					},
				},
			});

			expect(await configOf()).toEqual({
				name: "game",
				servePort: 34873,
				sourcePaths: ["src", "lib"],
				routes: {
					Server: "ServerScriptService/server",
					Client: "StarterPlayer/StarterPlayerScripts/client",
					Shared: "ReplicatedStorage/shared",
					"*": "ReplicatedStorage/shared",
				},
				tree: {
					$className: "DataModel",
					ReplicatedStorage: { Packages: { $path: "Packages" } },
				},
			});
		});

		it("should read the project from the file the config names", async () => {
			await write(
				"base.project.json",
				'{ "name": "base", "tree": { "$className": "DataModel" } }'
			);
			await writeConfig({ source: "src", project: "base.project.json" });

			expect(await configOf()).toMatchObject({ name: "base" });
		});

		it("should make the project v1 made for a config without one", async () => {
			await write("wally.toml", "");
			await fs.createDirectory(path.join(ROOT, "Packages"));
			await writeConfig({ source: "src" });

			expect((await configOf())?.tree).toEqual({
				$className: "DataModel",
				ReplicatedStorage: { Packages: { $path: "Packages" } },
			});
		});

		it("should keep the globs v1 wrote into its project file", async () => {
			await writeConfig({
				source: "src",
				globIgnorePaths: ["**/*.spec.luau"],
				luau: { globIgnorePaths: ["**/_drafts/**"] },
				project: { name: "x", globIgnorePaths: ["**/*.md"], tree: {} },
			});

			expect((await configOf())?.globIgnorePaths).toEqual([
				"**/*.md",
				"**/*.spec.luau",
				"**/_drafts/**",
			]);
		});
	});

	describe("routes", () => {
		it("should capitalise the wrapper folders with PascalCase", async () => {
			await writeConfig({ source: "src", casing: "PascalCase" });

			expect((await configOf())?.routes).toMatchObject({
				Server: "ServerScriptService/Server",
				"*": "ReplicatedStorage/Shared",
			});
		});

		it("should leave the wrapper folders out with unwrap", async () => {
			await writeConfig({ source: "src", unwrap: true });

			expect((await configOf())?.routes).toMatchObject({
				Server: "ServerScriptService",
				Client: "StarterPlayer/StarterPlayerScripts",
				"*": "ReplicatedStorage",
			});
		});

		it("should send client scripts to ReplicatedStorage without legacy scripts, as v1 did", async () => {
			await writeConfig({
				source: "src",
				project: { name: "x", emitLegacyScripts: false, tree: {} },
			});

			expect((await configOf())?.routes?.Client).toBe(
				"ReplicatedStorage/client"
			);
		});

		it("should route each alias, over a built-in word of the same name", async () => {
			await writeConfig({
				source: "src",
				aliases: {
					Controller: "StarterPlayerScripts",
					client: "ReplicatedFirst",
				},
			});

			expect((await configOf())?.routes).toEqual({
				Server: "ServerScriptService/server",
				client: "ReplicatedFirst/client",
				Shared: "ReplicatedStorage/shared",
				Controller: "StarterPlayer/StarterPlayerScripts/client",
				"*": "ReplicatedStorage/shared",
			});
		});

		it("should route a service only when the source folders use its name", async () => {
			await write("src/Boot/ReplicatedFirst/Loader.client.luau");
			await write("src/Net/Cache_ServerStorage.luau");
			await write("src/Ui/.StarterGui");
			await writeConfig({ source: "src" });

			expect((await configOf())?.routes).toEqual({
				Server: "ServerScriptService/server",
				Client: "StarterPlayer/StarterPlayerScripts/client",
				Shared: "ReplicatedStorage/shared",
				ReplicatedFirst: "ReplicatedFirst/client",
				ServerStorage: "ServerStorage/server",
				StarterGui: "StarterGui/client",
				"*": "ReplicatedStorage/shared",
			});
		});

		it("should warn about an alias that sends files to no service", async () => {
			await writeConfig({
				source: "src",
				aliases: { Hello: "src/Hello.luau" },
			});
			await write("src/Greeting_Hello.luau");

			expect((await configOf())?.routes).not.toHaveProperty("Hello");
			expect(await codesOf()).toEqual(["legacy.aliasKey"]);
			expect(await renamesOf()).toEqual([]);
		});

		it("should warn about an alias that can't be a route key", async () => {
			await writeConfig({
				source: "src",
				aliases: { "ui-kit": "StarterGui" },
			});

			expect((await configOf())?.routes).not.toHaveProperty("ui-kit");
			expect(await codesOf()).toEqual(["legacy.aliasKey"]);
		});
	});

	describe("modes", () => {
		it("should write a config for each mode that ran, named after its output", async () => {
			await write(".darklua.json", "{}");
			await writeConfig({ source: "src" });

			expect(
				(await migrate()).configs.map(({ fileName, config }) => [
					fileName,
					config.compiledPath,
				])
			).toEqual([
				["default.rogen.json", undefined],
				["build.rogen.json", "dist"],
			]);
		});

		it("should sync a roblox-ts project from where it compiles to", async () => {
			await write("tsconfig.json", "{}");
			await writeConfig({ source: "src" });

			expect(await configOf()).toMatchObject({
				sourcePaths: ["src"],
				compiledPath: "out",
			});
		});

		it("should write a custom mode's config, relative to where its output was", async () => {
			await writeConfig({
				source: ["src/core"],
				release: {
					output: "places/release.project.json",
					build: "dist",
				},
			});

			expect(await configOf("places/release.rogen.json")).toMatchObject({
				sourcePaths: ["../src/core"],
				compiledPath: "../dist",
			});
		});

		it("should write one config when two modes wrote one project file", async () => {
			await writeConfig({
				source: "src",
				other: { output: "default.project.json", build: "src" },
			});

			const found = await migrate();

			expect(found.configs).toHaveLength(1);
			expect(found.warnings.map(({ code }) => code)).toEqual([
				"legacy.outputClash",
			]);
		});
	});

	describe("renames", () => {
		beforeEach(() => writeConfig({ source: "src" }));

		it("should give v2's @ to each name v1 routed by a word", async () => {
			for (const name of [
				"Combat_Server.luau",
				"server-Hit.luau",
				"HudClient.luau",
				"clientInput.luau",
				"Types.shared.luau",
				"Config+server.json",
			])
				await write(`src/Combat/${name}`);

			expect(
				(await renamesOf()).map(({ from, to }) => [
					path.posix.basename(from),
					path.posix.basename(to),
				])
			).toEqual(
				expect.arrayContaining([
					["Combat_Server.luau", "Combat@Server.luau"],
					["Config+server.json", "Config@Server.json"],
					["HudClient.luau", "Hud@Client.luau"],
					["Types.shared.luau", "Types@Shared.luau"],
					["clientInput.luau", "Input@Client.luau"],
					["server-Hit.luau", "Hit@Server.luau"],
				])
			);
		});

		it("should leave Rojo's script suffixes, which v2 routes by too", async () => {
			await write("src/Boot/Boot.server.luau");
			await write("src/Boot/Hud.client.lua");

			expect(await renamesOf()).toEqual([]);
		});

		it("should keep the word in the name with verbatim", async () => {
			await writeConfig({ source: "src", verbatim: true });
			await write("src/Combat/Combat_Server.luau");

			expect(await renamesOf()).toEqual([
				{
					from: "src/Combat/Combat_Server.luau",
					to: "src/Combat/Combat_Server@Server.luau",
				},
			]);
		});

		it("should keep the word in the names of a folder with a .verbatim marker", async () => {
			await write("src/Combat/.verbatim", "");
			await write("src/Combat/Combat_Server.luau");

			expect((await renamesOf())[0]?.to).toBe(
				"src/Combat/Combat_Server@Server.luau"
			);
		});

		it("should keep a ^ at the front of the name", async () => {
			await write("src/Admin/^Panel_Client.luau");

			expect((await renamesOf())[0]?.to).toBe(
				"src/Admin/^Panel@Client.luau"
			);
		});

		it("should turn a routing marker into v2's @ marker", async () => {
			await write("src/Anticheat/.server", "");

			expect(await renamesOf()).toEqual([
				{ from: "src/Anticheat/.server", to: "src/Anticheat/@Server" },
			]);
		});

		it("should move the meta file of a renamed script with it", async () => {
			await write("src/Combat/Combat_Server.luau");
			await write("src/Combat/Combat_Server.meta.json", "{}");

			expect(await renamesOf()).toContainEqual({
				from: "src/Combat/Combat_Server.meta.json",
				to: "src/Combat/Combat@Server.meta.json",
			});
		});

		it("should leave the files of an init folder or a .sync folder, which v1 never routed", async () => {
			await write("src/Shaker/init.luau");
			await write("src/Shaker/Spring_Server.luau");
			await write("src/Raw/.sync", "");
			await write("src/Raw/Raw_Server.luau");

			expect(await renamesOf()).toEqual([]);
		});

		it("should warn about a roblox-ts file instead of renaming it", async () => {
			await write("src/Combat/CombatServer.ts", "export {}");

			expect(await renamesOf()).toEqual([]);
			expect((await migrate()).warnings).toMatchObject([
				{
					code: "legacy.typeScriptName",
					resource: path.join(ROOT, "src/Combat/CombatServer.ts"),
				},
			]);
		});

		it("should warn instead of renaming when the new name is taken", async () => {
			await write("src/Combat/Combat_Server.luau");
			await write("src/Combat/Combat@Server.luau");

			expect(await renamesOf()).toEqual([]);
			expect(await codesOf()).toEqual(["legacy.renameClash"]);
		});

		it("should warn when two configs route a shared file apart", async () => {
			await writeConfig({ source: "src" });
			await writeConfig(
				{
					source: "src",
					verbatim: true,
					luau: { output: "lobby.project.json" },
				},
				"lobby.rogen.json"
			);
			await write("src/Combat/Combat_Server.luau");

			expect(await renamesOf()).toHaveLength(1);
			expect(await codesOf()).toEqual(["legacy.renameClash"]);
		});
	});

	describe("what it can't carry over", () => {
		it("should warn about tags and the files they pick", async () => {
			await writeConfig({ source: "src", tags: { dev: false } });
			await write("src/Debug/Cheats_dev.luau");
			await write("src/dev/Tool_Server.luau");

			const [warning, ...others] = (await migrate()).warnings;

			expect(others).toEqual([]);
			expect(warning.code).toBe("legacy.tags");
			expect(warning.message).toContain(
				"src/Debug/Cheats_dev.luau and src/dev/Tool_Server.luau"
			);
			expect(await renamesOf()).toEqual([]);
		});

		it("should warn about v1's markers that change how a folder is read", async () => {
			await writeConfig({ source: "src" });
			for (const marker of ["structure", "unwrap", "sync"])
				await write(`src/${marker}/.${marker}`, "");

			expect(await codesOf()).toEqual([
				"legacy.marker",
				"legacy.marker",
				"legacy.marker",
			]);
		});

		it("should not route the names in a .structure folder", async () => {
			await writeConfig({ source: "src" });
			await write("src/Lib/.structure", "");
			await write("src/Lib/Signal_Server.luau");

			expect(await renamesOf()).toEqual([]);
		});

		it("should warn about a file that v1 placed by its deepest routing word", async () => {
			await writeConfig({ source: "src" });
			await write("src/Boot/ReplicatedFirst/Loader.client.luau");
			await write("src/Server/Shared/Types.luau");
			await write("src/Server/Data.luau");

			expect((await migrate()).warnings).toMatchObject([
				{
					code: "legacy.outrankedRoute",
					resource: path.join(
						ROOT,
						"src/Boot/ReplicatedFirst/Loader.client.luau"
					),
				},
				{
					code: "legacy.outrankedRoute",
					resource: path.join(ROOT, "src/Server/Shared/Types.luau"),
				},
			]);
		});
	});
});
