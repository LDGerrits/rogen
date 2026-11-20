/** Projects in each layout routing allows, and the edits a person makes in Studio, which syncback must write back so the rebuilt place is the edited one. */

const SSS = "ServerScriptService";
const SPS = "StarterPlayer/StarterPlayerScripts";
const RS = "ReplicatedStorage/Shared";

const NAMES = { Server: SSS, Client: SPS, Shared: RS, "*": RS };
const LOWER = { server: SSS, client: SPS, shared: RS, "*": RS };
const GLOBS = {
	...NAMES,
	"*[Ss]ervice": SSS,
	"*{Controller,Component}": SPS,
};

/** What a run of the matrix expects besides a rebuilt place equal to the edited one. */
export type Outcome =
	| { readonly kind: "roundTrip" }
	/** Syncback leaves the instance out with a warning, as no file name can hold it. */
	| { readonly kind: "refused"; readonly why: string }
	/** Rojo's own syncback drops the change, which Rogen can't see without reading the place. */
	| { readonly kind: "rojoLimit"; readonly why: string };

export interface MatrixRun {
	readonly name: string;
	readonly routes: Readonly<Record<string, string>>;
	/** Paths below `src`. */
	readonly files: readonly string[];
	/** Luau run in the place with `game`, as in Studio's command bar, after `PRELUDE`. */
	readonly edit: string;
	readonly outcome: Outcome;
}

/** Helpers the edits use: `at` finds an instance by its path, `new` and `mod` make one. */
export const PRELUDE = `local function at(p) local i=game for part in string.gmatch(p,"[^/]+") do local n=i:FindFirstChild(part) if not n then error("no "..part.." in "..p) end i=n end return i end
local function new(class,parent,name,src) local m=Instance.new(class) m.Name=name if src then m.Source=src end m.Parent=at(parent) return m end
local function mod(parent,name) return new("ModuleScript",parent,name,"return {}\\n") end
`;

interface Layout {
	readonly routes: Readonly<Record<string, string>>;
	readonly files: readonly string[];
	/** The feature's node on the server, the client and in Shared, a server module, a client module, and an init script's node. */
	readonly server: string;
	readonly client: string;
	readonly shared?: string;
	readonly serverModule: string;
	readonly clientModule: string;
	readonly init?: string;
	/** Another feature on the server, for moves between features. */
	readonly other?: string;
}

const LAYOUTS: Readonly<Record<string, Layout>> = {
	folders: {
		routes: NAMES,
		files: [
			"Shop/Server/ShopService.luau",
			"Shop/Server/Util/init.luau",
			"Shop/Server/Util/Math.luau",
			"Shop/Client/ShopUi.luau",
			"Shop/Shared/Prices.luau",
			"Bag/Server/Bag.luau",
			"Bag/Shared/Item.luau",
		],
		server: `${SSS}/Shop`,
		client: `${SPS}/Shop`,
		shared: `${RS}/Shop`,
		serverModule: "ShopService",
		clientModule: "ShopUi",
		init: `${SSS}/Shop/Util`,
		other: `${SSS}/Bag`,
	},
	suffix: {
		routes: NAMES,
		files: [
			"Shop/ShopService@Server.luau",
			"Shop/ShopUi@Client.luau",
			"Shop/Prices.luau",
			"Bag/Bag@Server.luau",
			"Bag/Item.luau",
		],
		server: `${SSS}/Shop`,
		client: `${SPS}/Shop`,
		shared: `${RS}/Shop`,
		serverModule: "ShopService",
		clientModule: "ShopUi",
		other: `${SSS}/Bag`,
	},
	marker: {
		routes: NAMES,
		files: [
			"Shop/@Server",
			"Shop/ShopService.luau",
			"Shop/Util.luau",
			"Hud/@Client",
			"Hud/Bar.luau",
			"Lib/Types.luau",
		],
		server: `${SSS}/Shop`,
		client: `${SPS}/Hud`,
		shared: `${RS}/Lib`,
		serverModule: "ShopService",
		clientModule: "Bar",
	},
	atFolders: {
		routes: NAMES,
		files: [
			"Shop@Server/ShopService.luau",
			"Shop@Client/ShopUi.luau",
			"Bag/@Server/Bag.luau",
			"Bag/Item.luau",
		],
		server: `${SSS}/Shop`,
		client: `${SPS}/Shop`,
		shared: `${RS}/Bag`,
		serverModule: "ShopService",
		clientModule: "ShopUi",
	},
	inits: {
		routes: NAMES,
		files: [
			"Net/init.luau",
			"Net/Server/Remote.luau",
			"Net/Client/Listener.luau",
			"Net/Types.luau",
			"Store/init@Client.luau",
			"Store/Client/Row.luau",
			"Store/Server/Save.luau",
			"Boot/init.server.luau",
			"Boot/Step.luau",
		],
		server: `${SSS}/Net`,
		client: `${SPS}/Store`,
		shared: `${RS}/Net`,
		serverModule: "Remote",
		clientModule: "Row",
		init: `${SPS}/Store`,
	},
	patterns: {
		routes: {
			...NAMES,
			"*Controller": SPS,
			"*Service": SSS,
		},
		files: [
			"Shop/ShopController.luau",
			"Shop/ShopService.luau",
			"Shop/Prices.luau",
			"Input/InputController/init.luau",
			"Input/InputController/Keys.luau",
		],
		server: `${SSS}/Shop`,
		client: `${SPS}/Shop`,
		shared: `${RS}/Shop`,
		serverModule: "ShopService",
		clientModule: "ShopController",
		init: `${RS}/Input/InputController`,
	},
	globs: {
		routes: GLOBS,
		files: [
			"Shop/ShopService.luau",
			"Shop/ShopController.luau",
			"Shop/Prices.luau",
			"Shop/Server/Store.luau",
			"Shop/Shared/Types.luau",
			"Bag/BagService.luau",
			"Bag/BagComponent.luau",
		],
		server: `${SSS}/Shop`,
		client: `${SPS}/Shop`,
		shared: `${RS}/Shop`,
		serverModule: "ShopService",
		clientModule: "ShopController",
		other: `${SSS}/Bag`,
	},
	invisible: {
		routes: {
			...NAMES,
			Character: "StarterPlayer/StarterCharacterScripts",
		},
		files: [
			"Shop/Client/(Ui)/Button.luau",
			"Shop/Client/(Ui)/Icon.luau",
			"Shop/Client/ShopUi.luau",
			"Shop/Server/ShopService.luau",
			"Player/@Character",
			"Player/^Animate.client.luau",
			"Player/Sprint.client.luau",
		],
		server: `${SSS}/Shop`,
		client: `${SPS}/Shop`,
		serverModule: "ShopService",
		clientModule: "Button",
	},
	lower: {
		routes: LOWER,
		files: [
			"Shop/server/ShopService.luau",
			"Shop/client/ShopUi.luau",
			"Shop/shared/Prices.luau",
			"Bag/server/Bag.luau",
			"Bag/Save@server.luau",
		],
		server: `${SSS}/Shop`,
		client: `${SPS}/Shop`,
		shared: `${RS}/Shop`,
		serverModule: "ShopService",
		clientModule: "ShopUi",
		other: `${SSS}/Bag`,
	},
	scripts: {
		routes: NAMES,
		files: [
			"Shop/Server/Main.server.luau",
			"Shop/Server/Main.meta.json",
			"Shop/Client/Hud.client.luau",
			"Shop/Server/Lib.luau",
		],
		server: `${SSS}/Shop`,
		client: `${SPS}/Shop`,
		serverModule: "Lib",
		clientModule: "Hud",
	},
};

const ROUND_TRIP: Outcome = { kind: "roundTrip" };
const NESTED_IN_FILE: Outcome = {
	kind: "rojoLimit",
	why: "Rojo drops a child added under a script that is a single file",
};
const CLASS_CHANGE: Outcome = {
	kind: "rojoLimit",
	why: "Rojo keeps the file of an instance whose class changed under the same name",
};
const MISREAD: Outcome = {
	kind: "refused",
	why: "routing reads the name as a route, so syncback leaves it out",
};

function editsOf(layout: Layout): [string, string, Outcome][] {
	const { server, client, shared, serverModule, clientModule, init, other } =
		layout;
	const feature = server.split("/").at(-1)!;
	const sides = [server, client, shared].filter(
		(side): side is string =>
			side !== undefined && side.split("/").at(-1) === feature
	);
	const edits: [string, string, Outcome][] = [
		["add-server", `mod("${server}","Added")`, ROUND_TRIP],
		["add-client", `mod("${client}","Added")`, ROUND_TRIP],
		[
			"add-folder",
			`new("Folder","${server}","Sub") mod("${server}/Sub","Inner")`,
			ROUND_TRIP,
		],
		[
			"rename-module",
			`at("${server}/${serverModule}").Name="Renamed"`,
			ROUND_TRIP,
		],
		[
			"delete-module",
			`at("${server}/${serverModule}"):Destroy()`,
			ROUND_TRIP,
		],
		[
			"edit-source",
			`at("${server}/${serverModule}").Source="return 42\\n"`,
			ROUND_TRIP,
		],
		[
			"move-server-to-client",
			`at("${server}/${serverModule}").Parent=at("${client}")`,
			ROUND_TRIP,
		],
		[
			"attribute",
			`at("${server}/${serverModule}"):SetAttribute("Level",3)`,
			ROUND_TRIP,
		],
		[
			"add-script",
			`new("Script","${server}","Boot2","print(1)\\n") new("LocalScript","${client}","Hud2","print(2)\\n")`,
			ROUND_TRIP,
		],
		[
			"new-feature",
			`new("Folder","${SSS}","Quest") mod("${SSS}/Quest","Tracker") new("Folder","${SPS}","Quest") mod("${SPS}/Quest","Log")`,
			ROUND_TRIP,
		],
		[
			"rename-client",
			`at("${client}/${clientModule}").Name="Renamed2"`,
			ROUND_TRIP,
		],
		[
			"nested-script-module",
			`mod("${server}/${serverModule}","Child")`,
			NESTED_IN_FILE,
		],
		[
			"rename-feature",
			sides.map((side) => `at("${side}").Name="${feature}X"`).join(" "),
			ROUND_TRIP,
		],
		[
			"name-with-at",
			`mod("${server}","Foo@Server") mod("${server}","Bar@Zed")`,
			MISREAD,
		],
		["name-hoist", `mod("${server}","^Odd")`, MISREAD],
		[
			"name-parens",
			`new("Folder","${server}","(Group)") mod("${server}/(Group)","In")`,
			MISREAD,
		],
		[
			"move-into-nested",
			`new("Folder","${server}","Deep") at("${server}/${serverModule}").Parent=at("${server}/Deep")`,
			ROUND_TRIP,
		],
		[
			"swap-names",
			`local a=at("${server}/${serverModule}") local m=mod("${server}","Other") a.Name="Tmp" m.Name="${serverModule}" a.Name="Other"`,
			ROUND_TRIP,
		],
		["rename-one-side", `at("${server}").Name="${feature}Y"`, ROUND_TRIP],
		[
			"case-rename",
			`at("${server}/${serverModule}").Name=string.lower("${serverModule}")`,
			ROUND_TRIP,
		],
		[
			"class-change",
			`local o=at("${server}/${serverModule}") local s=new("Script","${server}","Tmp","print(1)\\n") o:Destroy() s.Name="${serverModule}"`,
			CLASS_CHANGE,
		],
	];
	if (shared)
		edits.push([
			"add-shared",
			`mod("${shared}","AddedShared")`,
			ROUND_TRIP,
		]);
	if (init)
		edits.push(["init-child", `mod("${init}","InitChild")`, ROUND_TRIP]);
	if (other)
		edits.push(
			[
				"move-across-features",
				`at("${server}/${serverModule}").Parent=at("${other}")`,
				ROUND_TRIP,
			],
			[
				"reparent-side",
				`at("${server}").Parent=at("${other}")`,
				ROUND_TRIP,
			]
		);
	return edits;
}

/** Edits of the globs layout whose names start or stop matching a pattern, or that empty a side only a pattern routes. */
const GLOB_EDITS: [string, string, Outcome][] = [
	["pattern-into-shared", `mod("${RS}/Shop","PayService")`, ROUND_TRIP],
	["pattern-into-server", `mod("${SSS}/Shop","CartController")`, ROUND_TRIP],
	["pattern-into-client", `mod("${SPS}/Shop","UiService")`, ROUND_TRIP],
	[
		"rename-into-pattern",
		`at("${RS}/Shop/Prices").Name="PriceService"`,
		ROUND_TRIP,
	],
	[
		"rename-out-of-pattern",
		`at("${SSS}/Shop/ShopService").Name="Shop"`,
		ROUND_TRIP,
	],
	[
		"rename-across-patterns",
		`at("${SSS}/Shop/ShopService").Name="ShopController"`,
		ROUND_TRIP,
	],
	[
		"pattern-named-folder",
		`new("Folder","${SSS}/Shop","DataService") mod("${SSS}/Shop/DataService","Inner")`,
		ROUND_TRIP,
	],
	[
		"pattern-new-feature",
		`new("Folder","${SSS}","Quest") mod("${SSS}/Quest","QuestController") new("Folder","${RS}","Quest") mod("${RS}/Quest","QuestService")`,
		ROUND_TRIP,
	],
	[
		"name-with-dot-script",
		`new("Script","${SSS}/Shop","Main.v2","print(1)\\n")`,
		ROUND_TRIP,
	],
	["name-with-at-pattern", `mod("${SSS}/Shop","Pay@Service")`, ROUND_TRIP],
	[
		"pattern-module-child",
		`mod("${SPS}/Bag/BagComponent","Part")`,
		NESTED_IN_FILE,
	],
	[
		"delete-last-pattern-file",
		`at("${SPS}/Bag/BagComponent"):Destroy()`,
		ROUND_TRIP,
	],
];

/** Features whose only files the fallback routes, or one pattern routes. */
const GLOB_FEATURES: MatrixRun[] = [
	{
		name: "globs · pattern-into-fallback-side",
		routes: GLOBS,
		files: ["Shop/Prices.luau"],
		edit: `mod("${RS}/Shop","PayService")`,
		outcome: ROUND_TRIP,
	},
	{
		name: "globs · delete-only-pattern-file",
		routes: GLOBS,
		files: ["Bag/BagComponent.luau", "Shop/Prices.luau"],
		edit: `at("${SPS}/Bag/BagComponent"):Destroy()`,
		outcome: ROUND_TRIP,
	},
];

/** Every layout with every edit. */
export function syncbackMatrix(): MatrixRun[] {
	const runs = (
		layoutName: string,
		layout: Layout,
		edits: [string, string, Outcome][]
	) =>
		edits.map(([editName, edit, outcome]) => ({
			name: `${layoutName} · ${editName}`,
			routes: layout.routes,
			files: layout.files,
			edit,
			outcome,
		}));
	return [
		...Object.entries(LAYOUTS).flatMap(([layoutName, layout]) =>
			runs(layoutName, layout, editsOf(layout))
		),
		...runs("globs", LAYOUTS.globs, GLOB_EDITS),
		...GLOB_FEATURES,
	];
}
