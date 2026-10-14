import { DeclaredKeys } from "../../config/declared-keys.js";
import {
	Misspelling,
	MisspellingKind,
	MisspellingOf,
} from "../misspelling-finder.js";
import { NameReader } from "../name-reader.js";

const ROUTES = new Set(["server", "client", "shared"]);
const ROUTE_KEYS = new DeclaredKeys(ROUTES);

const readerOf = (keys: DeclaredKeys) => new NameReader(keys);
const matchMarkerKey = (fileName: string, keys: DeclaredKeys) =>
	readerOf(keys).marker(fileName).key;
const matchSuffixKeys = (stem: string, keys: ReadonlySet<string>) =>
	readerOf(new DeclaredKeys(keys)).suffixes(stem);
const misspelt = <K extends MisspellingKind>(
	read: { readonly misspellings: readonly Misspelling[] },
	kind: K
) =>
	read.misspellings.find(
		(misspelling): misspelling is MisspellingOf<K> =>
			misspelling.kind === kind
	);
const readFolderName = (folderName: string, keys: DeclaredKeys) =>
	readerOf(keys).folder(folderName);

describe("NameReader marker", () => {
	it("should match a route marker written with @", () => {
		expect(matchMarkerKey("@server", ROUTE_KEYS)).toBe("server");
	});

	it("should read a dot-file that spells a route as no marker, and note its @ form", () => {
		const read = readerOf(ROUTE_KEYS).marker(".server");

		expect(read.key).toBeUndefined();
		expect(misspelt(read, "dotRoute")).toEqual({
			kind: "dotRoute",
			text: "server",
			key: "server",
			respelling: { start: 0, written: ".server", spelling: "@server" },
		});
	});

	it("should note an @ marker that nearly spells a route", () => {
		expect(
			misspelt(readerOf(ROUTE_KEYS).marker("@sever"), "strayAt")
				?.suggestion
		).toBe("@server");
	});

	it("should offer a letter-case fix only for an @ marker", () => {
		expect(readerOf(ROUTE_KEYS).marker("@SERVER").nearMissKey).toBe(
			"server"
		);
		expect(
			readerOf(ROUTE_KEYS).marker(".SERVER").nearMissKey
		).toBeUndefined();
	});

	it("should note nothing about a letter-case miss, which has its own warning, or about a key spelt right", () => {
		expect(readerOf(ROUTE_KEYS).marker("@SERVER").misspellings).toEqual([]);
		expect(readerOf(ROUTE_KEYS).marker(".beta").misspellings).toEqual([]);
		expect(readerOf(ROUTE_KEYS).marker("@server").misspellings).toEqual([]);
	});

	it("matches with the first letter in the other case", () => {
		expect(matchMarkerKey("@Server", ROUTE_KEYS)).toBe("server");
	});

	it("does not match any other difference in case", () => {
		expect(matchMarkerKey("@SERVER", ROUTE_KEYS)).toBeUndefined();
		expect(readerOf(ROUTE_KEYS).marker("@SERVER")).toEqual({
			key: undefined,
			nearMissKey: "server",
			misspellings: [],
		});
	});

	it("ignores a name that doesn't start with a sign", () => {
		expect(matchMarkerKey("server", ROUTE_KEYS)).toBeUndefined();
	});

	it("ignores a bare dot", () => {
		expect(matchMarkerKey(".", ROUTE_KEYS)).toBeUndefined();
	});
});

describe("NameReader suffixes", () => {
	it("strips @key and names what stands before the @", () => {
		const result = matchSuffixKeys("Combat@server", ROUTES);
		expect(result.baseName).toBe("Combat");
		expect(result.matchedKeys).toEqual(new Set(["server"]));
		expect(result.spans).toEqual([{ key: "server", start: 6, length: 7 }]);
	});

	it("routes through a dot only for .server and .client", () => {
		for (const key of ["server", "client"]) {
			const result = matchSuffixKeys(`Combat.${key}`, ROUTES);
			expect(result.baseName).toBe("Combat");
			expect(result.matchedKeys).toEqual(new Set([key]));
		}
		const shared = matchSuffixKeys("Types.shared", ROUTES);
		expect(shared.baseName).toBe("Types.shared");
		expect(shared.matchedKeys.size).toBe(0);
	});

	it("leaves .server alone when no route of that name is declared", () => {
		const result = matchSuffixKeys("Combat.server", new Set(["shared"]));
		expect(result.matchedKeys.size).toBe(0);
	});

	it("does not route through -, _, + or a capital letter", () => {
		for (const stem of [
			"Combat-server",
			"Combat_server",
			"Combat+server",
			"CombatServer",
			"HttpClient",
		]) {
			const result = matchSuffixKeys(stem, ROUTES);
			expect(result.baseName).toBe(stem);
			expect(result.matchedKeys.size).toBe(0);
		}
	});

	it("does not treat a bare @key with nothing before it as a suffix", () => {
		const result = matchSuffixKeys("@server", ROUTES);
		expect(result.baseName).toBe("@server");
		expect(result.matchedKeys.size).toBe(0);
	});

	it("matches @key with the first letter in the other case", () => {
		expect(matchSuffixKeys("Foo@Server", ROUTES).matchedKeys).toEqual(
			new Set(["server"])
		);
		expect(
			matchSuffixKeys("Foo@server", new Set(["Server"])).matchedKeys
		).toEqual(new Set(["Server"]));
	});

	it("does not match @key that differs beyond the first letter", () => {
		expect(matchSuffixKeys("Foo@SERVER", ROUTES).matchedKeys.size).toBe(0);
	});

	it("records where each matched key sits in the stem, the trailing one first", () => {
		const result = readerOf(ROUTE_KEYS).suffixes("Foo@client@server");
		expect(result.spans).toEqual([
			{ key: "server", start: 10, length: 7 },
			{ key: "client", start: 3, length: 7 },
		]);
	});

	it("does not recognise an undeclared dot part", () => {
		const result = readerOf(ROUTE_KEYS).suffixes("Analytics.beta");
		expect(result.matchedKeys.size).toBe(0);
		expect(result.baseName).toBe("Analytics.beta");
	});

	it("does not route @key when a dot part follows it", () => {
		const result = readerOf(ROUTE_KEYS).suffixes("Foo@server.bak");
		expect(result.matchedKeys.size).toBe(0);
		expect(misspelt(result, "strayAt")).toEqual({
			kind: "strayAt",
			text: "server",
			suggestion: "@server",
			notLast: true,
		});
	});
});

describe("NameReader stray @", () => {
	it("names the closest declared route for an @ that matches none", () => {
		expect(
			misspelt(matchSuffixKeys("Save@sever", ROUTES), "strayAt")
		).toEqual({
			kind: "strayAt",
			text: "sever",
			suggestion: "@server",
			notLast: false,
			respelling: { start: 4, written: "@sever", spelling: "@server" },
		});
	});

	it("should give no respelling when another route is as close", () => {
		expect(
			misspelt(
				matchSuffixKeys("Save@serer", new Set(["server", "sever"])),
				"strayAt"
			)
		).toEqual({
			kind: "strayAt",
			text: "serer",
			suggestion: "@server",
			notLast: false,
		});
	});

	it("suggests the route for an @ that only differs in case", () => {
		expect(
			misspelt(matchSuffixKeys("Save@SERVER", ROUTES), "strayAt")
				?.suggestion
		).toBe("@server");
	});

	it("reports nothing for an @ that is no near miss of a route, such as a package name", () => {
		for (const stem of [
			"user@example",
			"Signal@rbxts",
			"sleitnick_knit@1.5.1",
		])
			expect(
				misspelt(matchSuffixKeys(stem, ROUTES), "strayAt")
			).toBeUndefined();
	});

	it("reports nothing for a name without an @, or a matched one", () => {
		expect(
			misspelt(matchSuffixKeys("Save", ROUTES), "strayAt")
		).toBeUndefined();
		expect(
			misspelt(matchSuffixKeys("Save@server", ROUTES), "strayAt")
		).toBeUndefined();
	});

	it("reports a leading @ only when it nearly spells a route", () => {
		expect(
			misspelt(matchSuffixKeys("@sever", ROUTES), "strayAt")
		).toMatchObject({
			text: "sever",
			suggestion: "@server",
		});
		expect(
			misspelt(matchSuffixKeys("@rbxts", ROUTES), "strayAt")
		).toBeUndefined();
		expect(
			misspelt(matchSuffixKeys("@server", ROUTES), "strayAt")
		).toBeUndefined();
	});

	it("reports nothing for a trailing @", () => {
		expect(
			misspelt(matchSuffixKeys("Save@", ROUTES), "strayAt")
		).toBeUndefined();
	});
});

describe("NameReader folder", () => {
	const read = (name: string) => readFolderName(name, ROUTE_KEYS);

	it("should read a folder named after a route as that route, spelled without an @, keeping no name", () => {
		expect(read("Server")).toEqual({
			invisible: false,
			hoisted: false,
			at: false,
			innerRoutes: [],
			route: "server",
			outrankedName: "Server",
			misspellings: [],
		});
	});

	it("should read a bare @key like the key alone", () => {
		expect(read("@server")).toMatchObject({ route: "server", at: true });
		expect(read("@server").keptName).toBeUndefined();
	});

	it("should read a dot-folder as an ordinary name", () => {
		expect(read(".mock")).toMatchObject({ at: false, keptName: ".mock" });
		expect(read(".mock").route).toBeUndefined();
	});

	it.each(["(^server)", "^(server)"])(
		"should read %s as an invisible hoisted route folder",
		(folderName) => {
			expect(read(folderName)).toMatchObject({
				route: "server",
				invisible: true,
				hoisted: true,
			});
		}
	);

	it("should read parentheses off first and mark the folder invisible", () => {
		expect(read("(server)")).toMatchObject({
			route: "server",
			invisible: true,
			hoisted: false,
		});
	});

	it("should read Name@key as a route folder that keeps Name", () => {
		expect(read("Matchmaking@server")).toEqual({
			invisible: false,
			hoisted: false,
			at: true,
			innerRoutes: [],
			route: "server",
			keptName: "Matchmaking",
			outrankedName: "Matchmaking@server",
			misspellings: [],
		});
	});

	it("should read @key with the first letter in the other case", () => {
		expect(read("Queue@Server")).toMatchObject({
			route: "server",
			keptName: "Queue",
		});
	});

	it("should read -server, .server and Rojo's script class as ordinary names", () => {
		for (const name of ["Queue-server", "Queue.server", "QueueServer"])
			expect(read(name)).toMatchObject({
				invisible: false,
				hoisted: false,
				at: false,
				innerRoutes: [],
				keptName: name,
				outrankedName: name,
			});
	});

	it("should note a route key after a folder's dot as a misspelling", () => {
		expect(
			misspelt(
				new NameReader(ROUTE_KEYS).folder("Queue.server"),
				"dotRoute"
			)
		).toMatchObject({ key: "server" });
	});

	it("should note each misspelling of a name once", () => {
		expect(
			readerOf(ROUTE_KEYS)
				.suffixes("Save@sever.Shared")
				.misspellings.map(({ kind }) => kind)
		).toEqual(["strayAt", "dotRoute"]);
	});

	it("should report the @ of a folder that matches no route", () => {
		expect(
			misspelt(
				new NameReader(ROUTE_KEYS).folder("Queue@sever"),
				"strayAt"
			)
		).toMatchObject({ text: "sever", suggestion: "@server" });
		expect(
			misspelt(new NameReader(ROUTE_KEYS).folder("@sever"), "strayAt")
		).toMatchObject({
			suggestion: "@server",
		});
		expect(
			misspelt(new NameReader(ROUTE_KEYS).folder("@rbxts"), "strayAt")
		).toBeUndefined();
	});

	it("should measure a respelling on the whole name of an invisible folder", () => {
		expect(
			misspelt(
				new NameReader(ROUTE_KEYS).folder("(Queue@sever)"),
				"strayAt"
			)?.respelling
		).toEqual({ start: 6, written: "@sever", spelling: "@server" });
	});

	it("should read any other folder as plain, keeping its name", () => {
		expect(read("Inventory")).toEqual({
			invisible: false,
			hoisted: false,
			at: false,
			innerRoutes: [],
			keptName: "Inventory",
			outrankedName: "Inventory",
			misspellings: [],
		});
	});
});

describe("NameReader folder typo", () => {
	it("should offer the one rename that fixes a folder one edit from a route key", () => {
		const keys = new DeclaredKeys(new Set(["server"]));

		expect(misspelt(readerOf(keys).folder("Sever"), "folderTypo")).toEqual({
			kind: "folderTypo",
			text: "Sever",
			key: "server",
			respelling: { start: 0, written: "Sever", spelling: "Server" },
		});
	});

	it("should offer no rename when two route keys are as close", () => {
		const keys = new DeclaredKeys(new Set(["bests", "tests"]));

		const typo = misspelt(readerOf(keys).folder("rests"), "folderTypo");

		expect(typo?.key).toBe("bests");
		expect(typo?.respelling).toBeUndefined();
	});

	it("should not offer a key shorter than four letters", () => {
		const keys = new DeclaredKeys(new Set(["abc"]));

		expect(
			misspelt(readerOf(keys).folder("abd"), "folderTypo")
		).toBeUndefined();
	});
});

describe("NameReader folder name offsets", () => {
	it.each([
		["Foo@sever", 3],
		["(Foo@sever)", 4],
		["^Foo@sever", 4],
		["(^Foo@sever)", 5],
		["^(Foo@sever)", 5],
	])(
		"should measure a respelling in %s from the start of the whole name",
		(folderName, start) => {
			const read = readFolderName(folderName, ROUTE_KEYS);

			expect(misspelt(read, "strayAt")?.respelling?.start).toBe(start);
		}
	);

	it("should read a dot-name misspelling as a plain name that keeps its dot", () => {
		expect(readFolderName(".server", ROUTE_KEYS)).toMatchObject({
			at: false,
			innerRoutes: [],
			keptName: ".server",
		});
	});
});

describe("NameReader routes in one name", () => {
	it("should route a folder by its last @key and keep the earlier ones as routes it outranks", () => {
		expect(readFolderName("Net@client@server", ROUTE_KEYS)).toMatchObject({
			route: "server",
			innerRoutes: ["client"],
			keptName: "Net@client",
		});
		expect(readFolderName("@client@server", ROUTE_KEYS)).toMatchObject({
			route: "server",
			innerRoutes: ["client"],
			keptName: "@client",
		});
	});

	it("should read a bare @key before another as a route, and alone as a name", () => {
		expect([
			...readerOf(ROUTE_KEYS).suffixes("@client@server").matchedKeys,
		]).toEqual(["server", "client"]);
		expect([
			...readerOf(ROUTE_KEYS).suffixes("@server").matchedKeys,
		]).toEqual([]);
	});
});

describe("NameReader dot routes", () => {
	const dotRoute = (stem: string, script: boolean) =>
		misspelt(readerOf(ROUTE_KEYS).suffixes(stem, script), "dotRoute")
			?.respelling;

	it("should read a route key after a dot in any letter case", () => {
		expect(dotRoute("Types.SHARED", false)).toEqual({
			start: 5,
			written: ".SHARED",
			spelling: "@shared",
		});
	});

	it("should respell Rojo's suffix on a script in Rojo's case, moved past any route suffix", () => {
		expect(dotRoute("Boot.Server", true)).toEqual({
			start: 4,
			written: ".Server",
			spelling: ".server",
		});
		expect(dotRoute("Boot.Server@client", true)).toEqual({
			start: 4,
			written: ".Server@client",
			spelling: "@client.server",
		});
		expect(dotRoute("Data.Server@client", false)).toEqual({
			start: 4,
			written: ".Server",
			spelling: "@server",
		});
	});
});
