import { Intent } from "../mirror-plan.js";
import { Disk, PlaceView, foldersRead, retain } from "../retention.js";
import { abs } from "./layout-fixtures.js";

const encoder = new TextEncoder();

const posix = (...segments: string[]) => abs(...segments).replaceAll("\\", "/");

const gone = (file: string, from?: string): Intent => ({
	kind: "gone",
	instance: from ?? file,
	file: abs(file),
	...(from !== undefined && { from }),
});

const write = (file: string, from?: string, text = "return 1"): Intent => ({
	kind: "write",
	instance: from ?? file,
	file: abs(file),
	bytes: encoder.encode(text),
	...(from !== undefined && { from }),
});

interface Case {
	readonly name: string;
	readonly intents: readonly Intent[];
	readonly disk: Readonly<Record<string, readonly string[]>>;
	readonly bytes?: Readonly<Record<string, string>>;
	readonly place?: Partial<PlaceView>;
	readonly operations: readonly string[];
	readonly gitkeeps?: readonly string[];
}

const SHOP = "ServerScriptService/Shop";

const placeOf = (
	intents: readonly Intent[],
	over: Partial<PlaceView> = {}
) => ({
	held: new Set<string>(),
	copied: new Set(
		intents.flatMap((intent) =>
			intent.kind !== "hold" && intent.from !== undefined
				? [intent.from]
				: []
		)
	),
	folders: new Map<string, string>(),
	sourcePaths: [abs("src")],
	instanceAt: (at: string) => at,
	...over,
});

const diskOf = (entries: Case["disk"], bytes: Case["bytes"] = {}): Disk => ({
	entriesOf: (folder) => entries[folder],
	bytesOf: (file) => {
		const text = bytes[file];
		return text === undefined ? undefined : encoder.encode(text);
	},
});

const shown = (operations: ReturnType<typeof retain>["operations"]) =>
	operations.map(({ kind, file }) => `${kind} ${file}`);

const CASES: readonly Case[] = [
	{
		name: "prunes the folders a removal empties, up to the source path",
		intents: [gone("src/Shop/Server/Cart.luau", `${SHOP}/Cart.luau`)],
		disk: {
			[abs("src/Shop/Server")]: ["Cart.luau"],
			[abs("src/Shop")]: ["Server"],
		},
		operations: [
			`remove ${abs("src/Shop/Server/Cart.luau")}`,
			`prune ${abs("src/Shop/Server")}`,
			`prune ${abs("src/Shop")}`,
		],
	},
	{
		name: "stops at a folder that still holds a file",
		intents: [gone("src/Shop/Server/Cart.luau", `${SHOP}/Cart.luau`)],
		disk: {
			[abs("src/Shop/Server")]: ["Cart.luau"],
			[abs("src/Shop")]: ["Server", "Client"],
		},
		operations: [
			`remove ${abs("src/Shop/Server/Cart.luau")}`,
			`prune ${abs("src/Shop/Server")}`,
		],
	},
	{
		name: "keeps a folder that couldn't be listed",
		intents: [gone("src/Shop/Server/Cart.luau", `${SHOP}/Cart.luau`)],
		disk: {},
		operations: [`remove ${abs("src/Shop/Server/Cart.luau")}`],
	},
	{
		name: "keeps a folder the place still holds with a .gitkeep",
		intents: [
			gone("src/Shop/Server/Util/Math.luau", `${SHOP}/Util/Math.luau`),
		],
		place: {
			held: new Set([SHOP]),
			folders: new Map([[SHOP, posix("src/Shop/Server")]]),
		},
		disk: {
			[abs("src/Shop/Server/Util")]: ["Math.luau"],
			[abs("src/Shop/Server")]: ["Util"],
		},
		operations: [
			`remove ${abs("src/Shop/Server/Util/Math.luau")}`,
			`prune ${abs("src/Shop/Server/Util")}`,
		],
		gitkeeps: [`write ${abs("src/Shop/Server/.gitkeep")}`],
	},
	{
		name: "adds no .gitkeep to a held folder the plan writes into",
		intents: [
			gone("src/Shop/Server/Cart.luau", `${SHOP}/Cart.luau`),
			write("src/Shop/Server/Bag.luau"),
		],
		place: { held: new Set([SHOP]) },
		disk: { [abs("src/Shop/Server")]: ["Cart.luau"] },
		operations: [
			`remove ${abs("src/Shop/Server/Cart.luau")}`,
			`write ${abs("src/Shop/Server/Bag.luau")}`,
		],
	},
	{
		name: "prunes a copied folder the place no longer holds, but not one it still mounts elsewhere",
		intents: [],
		place: {
			folders: new Map([
				["ReplicatedStorage/Packages", posix("Packages")],
				["ServerStorage/Packages", posix("Packages")],
				[`${SHOP}/Old`, posix("src/Shop/Server/Old")],
			]),
			held: new Set(["ServerStorage/Packages"]),
		},
		disk: {
			[abs("src/Shop/Server/Old")]: [],
			[abs("src/Shop/Server")]: ["Old", "Cart.luau"],
		},
		operations: [`prune ${abs("src/Shop/Server/Old")}`],
	},
	{
		name: "leaves out a compiled folder the place no longer holds",
		intents: [],
		place: {
			folders: new Map([["ServerScriptService/Out", posix("dist/Out")]]),
			compiledPath: abs("dist"),
		},
		disk: { [abs("dist/Out")]: [] },
		operations: [],
	},
	{
		name: "keeps a file a hold names, and the folders above it, whichever comes first",
		intents: [
			{
				kind: "hold",
				instance: SHOP,
				files: [abs("src/Shop/Server/Cart.luau")],
				reason: "kept",
			},
			gone("src/Shop/Server/Cart.luau", `${SHOP}/Cart.luau`),
		],
		disk: {
			[abs("src/Shop/Server")]: ["Cart.luau"],
			[abs("src/Shop")]: ["Server"],
		},
		operations: [],
	},
	{
		name: "keeps the removals of a refused instance and the files it was moved from",
		intents: [
			gone(
				"src/Shop/Server/Main.server.luau",
				`${SHOP}/Main.server.luau`
			),
			gone("src/Log.luau", "ServerScriptService/Log.luau"),
			{
				kind: "hold",
				instance: "ReplicatedStorage/Shared/Shop/Main",
				files: "movedFrom",
				moved: [{ bytes: encoder.encode("print(1)") }],
				reason: "refused",
			},
			{
				kind: "gone",
				instance: "ReplicatedStorage/Shared/Shop/Main",
				file: abs("src/Moved.luau"),
			},
		],
		bytes: {
			[abs("src/Shop/Server/Main.server.luau")]: "print(1)",
			[abs("src/Log.luau")]: "print(2)",
		},
		disk: {
			[abs("src/Shop/Server")]: ["Main.server.luau"],
			[abs("src/Shop")]: ["Server"],
		},
		operations: [`remove ${abs("src/Log.luau")}`],
	},
	{
		name: "never prunes a folder the plan writes into again",
		intents: [
			gone("src/Shop/Server/Cart.luau", `${SHOP}/Cart.luau`),
			write(
				"src/Shop/Shared/Cart.luau",
				"ReplicatedStorage/Shared/Shop/Cart.luau"
			),
		],
		place: { copied: new Set([`${SHOP}/Cart.luau`]) },
		disk: {
			[abs("src/Shop/Server")]: ["Cart.luau"],
			[abs("src/Shop")]: ["Server"],
		},
		operations: [
			`remove ${abs("src/Shop/Server/Cart.luau")}`,
			`prune ${abs("src/Shop/Server")}`,
			`write ${abs("src/Shop/Shared/Cart.luau")}`,
		],
	},
	{
		name: "lists Studio's changes to copied files, then the folders they empty, then the rest, each once",
		intents: [
			write("src/Shop/Server/New.luau"),
			write("src/Shop/Client/Hud.luau", "StarterPlayer/Hud.luau"),
			gone(
				"src/Old/Server/Cart.luau",
				"ServerScriptService/Old/Cart.luau"
			),
			write("src/Shop/Server/New.luau"),
			{
				kind: "gone",
				instance: "Store",
				file: abs("src/Old/Server"),
				folder: true,
			},
		],
		disk: {
			[abs("src/Old/Server")]: ["Cart.luau"],
			[abs("src/Old")]: ["Server", "Other.luau"],
		},
		operations: [
			`write ${abs("src/Shop/Client/Hud.luau")}`,
			`remove ${abs("src/Old/Server/Cart.luau")}`,
			`prune ${abs("src/Old/Server")}`,
			`write ${abs("src/Shop/Server/New.luau")}`,
		],
	},
];

describe("retain", () => {
	it.each(CASES)(
		"should follow its rule when it $name",
		({ intents, disk, bytes, place, operations, gitkeeps = [] }) => {
			const retained = retain(
				intents,
				diskOf(disk, bytes),
				placeOf(intents, place)
			);

			expect(shown(retained.operations)).toEqual(operations);
			expect(shown(retained.gitkeeps)).toEqual(gitkeeps);
		}
	);

	it("should name the removals a hold kept for a file", () => {
		const replaced = gone("dev/Shop/Server/Cart.luau", `${SHOP}/Cart.luau`);
		const intents: Intent[] = [
			replaced,
			gone("src/Shop/Server/Bag.luau", `${SHOP}/Bag.luau`),
			{
				kind: "hold",
				instance: SHOP,
				files: [abs("dev/Shop/Server/Cart.luau")],
				reason: "kept",
			},
		];

		expect(retain(intents, diskOf({}), placeOf(intents)).kept).toEqual([
			replaced,
		]);
	});

	it("should name the compiled folders it left out", () => {
		const place = placeOf([], {
			folders: new Map([["ServerScriptService/Out", posix("dist/Out")]]),
			compiledPath: abs("dist"),
		});

		expect(retain([], diskOf({}), place).leftOut).toEqual([
			"ServerScriptService/Out",
		]);
	});
});

describe("foldersRead", () => {
	it("should read every copied folder and every folder below a source path above a removal", () => {
		const intents = [
			gone("src/Shop/Server/Cart.luau", `${SHOP}/Cart.luau`),
		];
		const place = placeOf(intents, {
			folders: new Map([
				["ReplicatedStorage/Packages", posix("Packages")],
			]),
		});

		expect(foldersRead(intents, place).sort()).toEqual(
			[abs("Packages"), abs("src/Shop"), abs("src/Shop/Server")].sort()
		);
	});
});
