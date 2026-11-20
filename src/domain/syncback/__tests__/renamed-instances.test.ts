import { renamedInstances } from "../renamed-instances.js";
import { abs, layoutOf } from "./layout-fixtures.js";

/** Calls `renamedInstances` with removed mirror paths mapped to the sources they were copied from. */
const renamesOf = (
	instances: Parameters<typeof renamedInstances>[0],
	removed: ReadonlyMap<string, string>,
	placed: Parameters<typeof renamedInstances>[3]
) =>
	renamedInstances(
		instances,
		new Set(removed.keys()),
		(at) => {
			for (const [mirror, source] of removed) {
				if (at === mirror) return source;
				if (at.startsWith(`${mirror}/`))
					return `${source}${at.slice(mirror.length)}`;
			}
			return undefined;
		},
		placed
	);

const posix = (...segments: string[]) => abs(...segments).replaceAll("\\", "/");

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

		expect(renames.map(({ files }) => [...files.values()])).toEqual([
			[posix("src/Store/Server/Hit.luau")],
			[posix("src/Store/Client/Hud.luau")],
		]);
	});

	it("should leave a feature folder alone when a side it makes keeps the old name", async () => {
		const { placed } = await layoutOf([
			"src/Shop/Server/Hit.luau",
			"src/Shop/Client/Hud.luau",
		]);

		expect(
			renamesOf(
				[renamedTo("server", "Store", [["Store", "Hit.luau"]])],
				new Map([
					[
						"m/server/Shop/Hit.luau",
						posix("src/Shop/Server/Hit.luau"),
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
		expect([...rename.files.values()]).toEqual([
			posix("src/Store@Server/Hit.luau"),
			posix("src/Store@Server/Util/Math.luau"),
		]);
	});

	it("should not take an instance whose old one lost a file for a rename", async () => {
		const { placed } = await layoutOf([
			"src/Shop@Server/Hit.luau",
			"src/Shop@Server/Gone.luau",
		]);

		expect(
			renamesOf(
				[renamedTo("server", "Store", [["Store", "Hit.luau"]])],
				new Map([
					[
						"m/server/Shop/Hit.luau",
						posix("src/Shop@Server/Hit.luau"),
					],
					[
						"m/server/Shop/Gone.luau",
						posix("src/Shop@Server/Gone.luau"),
					],
				]),
				placed
			)
		).toEqual([]);
	});
});
