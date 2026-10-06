import { DeclaredKeys } from "../../config/config.js";
import { NameReader } from "../name-reader.js";

const ROUTES = new Set(["server", "client", "shared"]);
const ROUTE_KEYS = new DeclaredKeys(ROUTES, []);
const ALL_KEYS = new DeclaredKeys(ROUTES, ["mock", "debug"]);

const readerOf = (keys: DeclaredKeys) => new NameReader(keys);
const matchMarkerKey = (fileName: string, keys: DeclaredKeys) =>
	readerOf(keys).marker(fileName).key;
const matchSuffixKeys = (stem: string, keys: ReadonlySet<string>) =>
	readerOf(new DeclaredKeys(keys, [])).suffixes(stem);
const unwrapInvisibleFolder = NameReader.unwrapInvisibleFolder;
const readFolderName = (folderName: string, keys: DeclaredKeys) =>
	readerOf(keys).folder(folderName);

describe("NameReader marker", () => {
	it("matches a marker file named after a declared key", () => {
		expect(matchMarkerKey(".server", ROUTE_KEYS)).toBe("server");
	});

	it("matches a variant marker", () => {
		expect(matchMarkerKey(".mock", ALL_KEYS)).toBe("mock");
	});

	it("matches with the first letter in the other case", () => {
		expect(matchMarkerKey(".Server", ROUTE_KEYS)).toBe("server");
	});

	it("does not match any other difference in case", () => {
		expect(matchMarkerKey(".SERVER", ROUTE_KEYS)).toBeUndefined();
	});

	it("ignores a name that doesn't start with a dot", () => {
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

	it("stacks a variant and a route in either order", () => {
		const forward = readerOf(ALL_KEYS).suffixes("Foo.mock@server");
		expect(forward.baseName).toBe("Foo");
		expect(forward.matchedKeys).toEqual(new Set(["mock", "server"]));

		const backward = readerOf(ALL_KEYS).suffixes("Foo@server.mock");
		expect(backward.baseName).toBe("Foo");
		expect(backward.matchedKeys).toEqual(new Set(["mock", "server"]));
	});

	it("records where each matched key sits in the stem, the trailing one first", () => {
		const result = readerOf(ALL_KEYS).suffixes("Foo@server.mock");
		expect(result.spans).toEqual([
			{ key: "mock", start: 10, length: 5 },
			{ key: "server", start: 3, length: 7 },
		]);
	});

	it("stops the run at the first non-declared part: Foo.mock.Bar yields no keys", () => {
		const result = readerOf(ALL_KEYS).suffixes("Foo.mock.Bar");
		expect(result.matchedKeys.size).toBe(0);
		expect(result.baseName).toBe("Foo.mock.Bar");
	});

	it("does not recognise an undeclared dot part", () => {
		const result = readerOf(ALL_KEYS).suffixes("Analytics.beta");
		expect(result.matchedKeys.size).toBe(0);
		expect(result.baseName).toBe("Analytics.beta");
	});

	it("does not route @key when a dot part that isn't a variant follows it", () => {
		const result = readerOf(ALL_KEYS).suffixes("Foo@server.bak");
		expect(result.matchedKeys.size).toBe(0);
		expect(result.strayAt).toEqual({
			text: "server",
			closestKey: "server",
			notLast: true,
		});
	});
});

describe("NameReader variant typo", () => {
	const typoOf = (stem: string) =>
		readerOf(ALL_KEYS).suffixes(stem).variantTypo;

	it("names the declared variant a trailing dot part is one edit from", () => {
		expect(typoOf("Analytics.mok")).toEqual({
			text: "mok",
			variant: "mock",
		});
		expect(typoOf("Analytics.mcok")).toEqual({
			text: "mcok",
			variant: "mock",
		});
		expect(typoOf("Analytics.MOCK")).toEqual({
			text: "MOCK",
			variant: "mock",
		});
	});

	it("reports a typo that sits before a matched suffix", () => {
		expect(typoOf("Analytics.mok@server")?.variant).toBe("mock");
	});

	it("leaves .spec, .story and other ordinary dot parts alone", () => {
		expect(typoOf("Save.spec")).toBeUndefined();
		expect(typoOf("Hud.story")).toBeUndefined();
		expect(typoOf("Foo.beta")).toBeUndefined();
	});

	it("reports nothing for a matched variant, a name without a dot or a Rojo suffix", () => {
		expect(typoOf("Analytics.mock")).toBeUndefined();
		expect(typoOf("Analytics")).toBeUndefined();
		expect(typoOf("Main.client")).toBeUndefined();
	});
});

describe("NameReader stray @", () => {
	it("names the closest declared route for an @ that matches none", () => {
		expect(matchSuffixKeys("Save@sever", ROUTES).strayAt).toEqual({
			text: "sever",
			closestKey: "server",
			notLast: false,
		});
	});

	it("suggests the route for an @ that only differs in case", () => {
		expect(matchSuffixKeys("Save@SERVER", ROUTES).strayAt?.closestKey).toBe(
			"server"
		);
	});

	it("reports nothing for an @ that is no near miss of a route, such as a package name", () => {
		for (const stem of [
			"user@example",
			"Signal@rbxts",
			"sleitnick_knit@1.5.1",
		])
			expect(matchSuffixKeys(stem, ROUTES).strayAt).toBeUndefined();
	});

	it("is no near miss of a variant, only of a route", () => {
		expect(
			readerOf(new DeclaredKeys(ROUTES, ["mock"])).suffixes("Save@mok")
				.strayAt?.closestKey
		).toBeUndefined();
	});

	it("reports nothing for a name without an @, or a matched one", () => {
		expect(matchSuffixKeys("Save", ROUTES).strayAt).toBeUndefined();
		expect(matchSuffixKeys("Save@server", ROUTES).strayAt).toBeUndefined();
	});

	it("reports a leading @ only when it nearly spells a route", () => {
		expect(matchSuffixKeys("@sever", ROUTES).strayAt).toMatchObject({
			text: "sever",
			closestKey: "server",
		});
		expect(matchSuffixKeys("@rbxts", ROUTES).strayAt).toBeUndefined();
		expect(matchSuffixKeys("@server", ROUTES).strayAt).toBeUndefined();
	});

	it("reports nothing for a trailing @", () => {
		expect(matchSuffixKeys("Save@", ROUTES).strayAt).toBeUndefined();
	});
});

describe("NameReader.unwrapInvisibleFolder", () => {
	it("removes the parentheses and marks the folder invisible", () => {
		expect(unwrapInvisibleFolder("(mock)")).toEqual({
			name: "mock",
			invisible: true,
		});
	});

	it("leaves an ordinary name alone", () => {
		expect(unwrapInvisibleFolder("mock")).toEqual({
			name: "mock",
			invisible: false,
		});
	});

	it("ignores empty or unbalanced parentheses", () => {
		for (const name of ["()", "(mock", "mock)"])
			expect(unwrapInvisibleFolder(name)).toEqual({
				name,
				invisible: false,
			});
	});
});

describe("NameReader folder", () => {
	const read = (name: string) => readFolderName(name, ALL_KEYS);

	it("should read a folder named after a route as that route, keeping no name", () => {
		expect(read("Server")).toEqual({
			invisible: false,
			route: "server",
			variants: [],
			outrankedName: "Server",
		});
	});

	it("should read a folder named after a variant as that variant, keeping no name", () => {
		expect(read("mock")).toEqual({
			invisible: false,
			variants: ["mock"],
			outrankedName: "mock",
		});
	});

	it("should read a bare @key or .variant like the key alone", () => {
		expect(read("@server")).toMatchObject({ route: "server" });
		expect(read("@server").keptName).toBeUndefined();
		expect(read(".mock")).toMatchObject({ variants: ["mock"] });
		expect(read(".mock").keptName).toBeUndefined();
	});

	it("should read parentheses off first and mark the folder invisible", () => {
		expect(read("(server)")).toMatchObject({
			route: "server",
			invisible: true,
		});
	});

	it("should read Name@key as a route folder that keeps Name", () => {
		expect(read("Matchmaking@server")).toEqual({
			invisible: false,
			route: "server",
			variants: [],
			keptName: "Matchmaking",
			outrankedName: "Matchmaking@server",
		});
	});

	it("should read Name.variant as a variant folder that keeps Name", () => {
		expect(read("Analytics.mock")).toEqual({
			invisible: false,
			variants: ["mock"],
			keptName: "Analytics",
			outrankedName: "Analytics",
		});
	});

	it("should read a variant and a route in either order, and keep the route when it is outranked", () => {
		for (const name of ["Net.mock@server", "Net@server.mock"])
			expect(read(name)).toMatchObject({
				route: "server",
				variants: ["mock"],
				keptName: "Net",
				outrankedName: "Net@server",
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
			expect(read(name)).toEqual({
				invisible: false,
				variants: [],
				keptName: name,
				outrankedName: name,
			});
	});

	it("should report the @ of a folder that matches no route", () => {
		expect(
			new NameReader(ALL_KEYS).folderStrayAt("Queue@sever")
		).toMatchObject({ text: "sever", closestKey: "server" });
		expect(new NameReader(ALL_KEYS).folderStrayAt("@sever")).toMatchObject({
			closestKey: "server",
		});
		expect(
			new NameReader(ALL_KEYS).folderStrayAt("@rbxts")
		).toBeUndefined();
	});

	it("should report a dot part one edit from a variant", () => {
		expect(
			new NameReader(ALL_KEYS).folderVariantTypo("Analytics.mok")
		).toEqual({ text: "mok", variant: "mock" });
	});

	it("should read any other folder as plain, keeping its name", () => {
		expect(read("Inventory")).toEqual({
			invisible: false,
			variants: [],
			keptName: "Inventory",
			outrankedName: "Inventory",
		});
	});
});
