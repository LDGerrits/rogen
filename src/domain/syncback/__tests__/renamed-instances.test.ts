import { renamedInstances } from "../renamed-instances.js";
import { abs, layoutOf } from "./layout-fixtures.js";

const posix = (...segments: string[]) => abs(...segments).replaceAll("\\", "/");

const renamesOf = (
	instances: Parameters<typeof renamedInstances>[0],
	removed: ReadonlyMap<string, string>,
	placed: Parameters<typeof renamedInstances>[2]["placed"]
) =>
	renamedInstances(instances, new Set(removed.keys()), {
		sourceOf: (at) => {
			for (const [mirror, source] of removed) {
				if (at === mirror) return source;
				if (at.startsWith(`${mirror}/`))
					return `${source}${at.slice(mirror.length)}`;
			}
			return undefined;
		},
		placed,
		isRemoved: (source) =>
			[...removed.values()].some(
				(gone) => source === gone || source.startsWith(`${gone}/`)
			),
	});

const sides = {
	server: ["ServerScriptService"],
	client: ["StarterPlayer", "StarterPlayerScripts"],
};

const renamedTo = (
	side: keyof typeof sides,
	name: string,
	files: string[][]
) => ({
	parent: sides[side],
	name,
	folder: true,
	files,
	parentFolder: `m/${side}`,
});

describe("renamedInstances", () => {
	it("should keep the layout of a feature renamed on every side, renaming its folder", async () => {
		const { placed } = await layoutOf([
			"src/Shop/Server/Hit.luau",
			"src/Shop/Client/Hud.luau",
		]);

		const renames = renamesOf(
			[
				renamedTo("server", "Store", [["Store", "Hit.luau"]]),
				renamedTo("client", "Store", [["Store", "Hud.luau"]]),
			],
			new Map([
				["m/server/Shop/Hit.luau", posix("src/Shop/Server/Hit.luau")],
				["m/client/Shop/Hud.luau", posix("src/Shop/Client/Hud.luau")],
			]),
			placed
		);

		expect(
			renames.map(({ files }) =>
				[...files.values()].map(({ target }) => target)
			)
		).toEqual([
			[posix("src/Store/Server/Hit.luau")],
			[posix("src/Store/Client/Hud.luau")],
		]);
	});

	it("should move only the files of the side Studio renamed, in their own form, when another side keeps the old name", async () => {
		const { placed } = await layoutOf([
			"src/Shop/Server/Cfg.json",
			"src/Shop/Client/Hud.luau",
			"src/Bag/Cfg@Server.json",
			"src/Bag/Y.luau",
		]);

		const renames = renamesOf(
			[
				renamedTo("server", "BagX", [["BagX", "Cfg.luau"]]),
				renamedTo("server", "ShopX", [["ShopX", "Cfg.luau"]]),
			],
			new Map([
				["m/server/Shop/Cfg.json", posix("src/Shop/Server/Cfg.json")],
				["m/server/Bag/Cfg.json", posix("src/Bag/Cfg@Server.json")],
			]),
			placed
		);

		expect(renames.map(({ files }) => [...files.values()])).toEqual([
			[
				{
					target: posix("src/BagX/Cfg@Server.json"),
					keep: posix("src/Bag/Cfg@Server.json"),
				},
			],
			[
				{
					target: posix("src/ShopX/Server/Cfg.json"),
					keep: posix("src/Shop/Server/Cfg.json"),
				},
			],
		]);
	});

	it("should leave a feature folder alone when its sides are renamed to different names", async () => {
		const { placed } = await layoutOf([
			"src/Shop/Server/Hit.luau",
			"src/Shop/Client/Hud.luau",
		]);

		expect(
			renamesOf(
				[
					renamedTo("server", "Store", [["Store", "Hit.luau"]]),
					renamedTo("client", "Mall", [["Mall", "Hud.luau"]]),
				],
				new Map([
					[
						"m/server/Shop/Hit.luau",
						posix("src/Shop/Server/Hit.luau"),
					],
					[
						"m/client/Shop/Hud.luau",
						posix("src/Shop/Client/Hud.luau"),
					],
				]),
				placed
			)
		).toEqual([]);
	});

	it("should rename the name in a folder that routes by @, and the whole folder Rojo removed", async () => {
		const { placed } = await layoutOf([
			"src/Shop@Server/Hit.luau",
			"src/Shop@Server/Util/Math.luau",
		]);

		const [rename] = renamesOf(
			[
				renamedTo("server", "Store", [
					["Store", "Hit.luau"],
					["Store", "Util", "Math.luau"],
				]),
			],
			new Map([["m/server/Shop", posix("src/Shop@Server")]]),
			placed
		);

		expect(rename.renamed).toBe(posix("src/Store@Server"));
		expect([...rename.files.values()].map(({ target }) => target)).toEqual([
			posix("src/Store@Server/Hit.luau"),
			posix("src/Store@Server/Util/Math.luau"),
		]);
	});

	it("should take a rename whose old instance lost a file Studio deleted", async () => {
		const { placed } = await layoutOf([
			"src/Shop@Server/Hit.luau",
			"src/Shop@Server/Gone.luau",
		]);

		const [rename] = renamesOf(
			[renamedTo("server", "Store", [["Store", "Hit.luau"]])],
			new Map([["m/server/Shop", posix("src/Shop@Server")]]),
			placed
		);

		expect([...rename.files.values()]).toEqual([
			{ target: posix("src/Store@Server/Hit.luau") },
		]);
	});

	it("should move a file Rojo writes in another form as it was, and write a new child as its sibling is named", async () => {
		const { placed } = await layoutOf([
			"src/Shop/Items.json",
			"src/Shop/Hud@Client.luau",
		]);

		const renames = renamesOf(
			[
				{
					parent: ["ReplicatedStorage", "Shared"],
					name: "Store",
					folder: true,
					files: [["Store", "Items.luau"]],
					parentFolder: "m/shared",
				},
				renamedTo("client", "Store", [
					["Store", "Hud.luau"],
					["Store", "Fresh.luau"],
				]),
			],
			new Map([
				["m/shared/Shop", posix("src/Shop")],
				["m/client/Shop/Hud.luau", posix("src/Shop/Hud@Client.luau")],
			]),
			placed
		);

		expect(renames.map(({ files }) => [...files.values()])).toEqual([
			[
				{
					target: posix("src/Store/Items.json"),
					keep: posix("src/Shop/Items.json"),
				},
			],
			[
				{ target: posix("src/Store/Hud@Client.luau") },
				{ target: posix("src/Store/Fresh@Client.luau") },
			],
		]);
	});

	it("should write a script Rojo writes in another form under its new name, with its route mark, so Studio's edit stays", async () => {
		const { placed } = await layoutOf(["src/Shop/Hit@Server.lua"]);

		const [rename] = renamesOf(
			[renamedTo("server", "Store", [["Store", "Hit.server.luau"]])],
			new Map([["m/server/Shop", posix("src/Shop")]]),
			placed
		);

		expect([...rename.files.values()]).toEqual([
			{ target: posix("src/Store/Hit@Server.server.luau") },
		]);
	});

	it("should leave a rename to placing when a file of the old instance stays, as the plan keeps it", async () => {
		const { placed } = await layoutOf([
			"src/Shop@Server/Hit.luau",
			"src/Shop@Server/Kept.luau",
		]);

		expect(
			renamesOf(
				[renamedTo("server", "Store", [["Store", "Hit.luau"]])],
				new Map([
					[
						"m/server/Shop/Hit.luau",
						posix("src/Shop@Server/Hit.luau"),
					],
				]),
				placed
			)
		).toEqual([]);
	});

	it("should write a child added beside an init script alone as the init's route needs", async () => {
		const { placed } = await layoutOf(["src/Shop/init@Server.luau"]);

		const [rename] = renamesOf(
			[
				renamedTo("server", "Store", [
					["Store", "init.luau"],
					["Store", "New.luau"],
				]),
			],
			new Map([["m/server/Shop", posix("src/Shop")]]),
			placed
		);

		expect([...rename.files.values()]).toEqual([
			{ target: posix("src/Store/init@Server.luau") },
			{ target: posix("src/Store/New@Server.luau") },
		]);
	});

	it("should keep the ^ of a hoisted folder it renames", async () => {
		const { placed } = await layoutOf(["src/Ui/^Hud/Health.luau"]);

		const [rename] = renamesOf(
			[
				{
					parent: ["ReplicatedStorage", "Shared"],
					name: "Bar",
					folder: true,
					files: [["Bar", "Health.luau"]],
					parentFolder: "m/shared",
				},
			],
			new Map([["m/shared/Hud", posix("src/Ui/^Hud")]]),
			placed
		);

		expect(rename.renamed).toBe(posix("src/Ui/^Bar"));
	});

	it("should take the first of two files that make the same instance as its old file", async () => {
		const { placed } = await layoutOf(["src/Shop@Server/Hit.luau"]);
		const [hit] = placed;

		const [rename] = renamesOf(
			[renamedTo("server", "Store", [["Store", "Hit.luau"]])],
			new Map([["m/server/Shop", posix("src/Shop@Server")]]),
			[hit, { ...hit, source: posix("src/Shop@Server/Hit.server.luau") }]
		);

		expect([...rename.files.values()]).toEqual([
			{ target: posix("src/Store@Server/Hit.luau") },
		]);
	});

	it("should find no rename in a removed file that made no folder", async () => {
		const { placed } = await layoutOf([
			"src/Shop@Server/Hit.luau",
			"src/Old@Server.luau",
		]);

		expect(
			renamesOf(
				[renamedTo("server", "Store", [["Store", "Hit.luau"]])],
				new Map([["m/server/Old.luau", posix("src/Old@Server.luau")]]),
				placed
			)
		).toEqual([]);
	});

	it("should find no rename from a folder whose name doesn't spell the old instance", async () => {
		const { placed } = await layoutOf(["src/Shop@Server/Hit.luau"]);

		expect(
			renamesOf(
				[renamedTo("server", "Store", [["Store", "Hit.luau"]])],
				new Map([["m/server/Shop", posix("src/Shop@Server")]]),
				placed.map((file) => ({
					...file,
					folderNodes: file.folderNodes?.map((node) => ({
						...node,
						folder: posix("src/Market@Server"),
					})),
				}))
			)
		).toEqual([]);
	});

	it("should find no rename when a meta of the new instance has no file in the old folder", async () => {
		const { placed } = await layoutOf(["src/Shop@Server/Hit.luau"]);

		expect(
			renamesOf(
				[
					renamedTo("server", "Store", [
						["Store", "Hit.luau"],
						["Store", "Hit.meta.json"],
					]),
				],
				new Map([
					[
						"m/server/Shop/Hit.luau",
						posix("src/Shop@Server/Hit.luau"),
					],
				]),
				placed
			)
		).toEqual([]);
	});

	it("should find no rename when a file of the old instance lies outside its folder", async () => {
		const { placed } = await layoutOf(
			["src/Shop/Server/Hit.luau", "lib/Shop/Server/Util.luau"],
			{ sourcePaths: [abs("src"), abs("lib")] }
		);

		expect(
			renamesOf(
				[
					renamedTo("server", "Store", [
						["Store", "Hit.luau"],
						["Store", "Util.luau"],
					]),
				],
				new Map([
					[
						"m/server/Shop/Hit.luau",
						posix("src/Shop/Server/Hit.luau"),
					],
					[
						"m/server/Shop/Util.luau",
						posix("lib/Shop/Server/Util.luau"),
					],
				]),
				placed
			)
		).toEqual([]);
	});

	it("should find no rename when the new instance holds only children it can't name by a sibling", async () => {
		const { placed } = await layoutOf(["src/Shop@Server/Hit.luau"]);

		expect(
			renamesOf(
				[renamedTo("server", "Store", [["Store", "New.luau"]])],
				new Map([["m/server/Shop", posix("src/Shop@Server")]]),
				placed
			)
		).toEqual([]);
	});
});
