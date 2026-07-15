import { resolveRoute, RouteContext } from "../src/route.js";
import { generateRoutingMaps } from "../src/constants.js";

describe("Router Logic", () => {
	const baseContext: RouteContext = {
		source: "src",
		build: "src",
		output: "test.project.json",
		name: "test-game",
		emitLegacyScripts: true,
		isTsProject: false,
		verbatim: false,
		routingMaps: generateRoutingMaps(),
		directoryMarkers: {},
		environments: new Set(),
		activeEnv: new Set(),
		envRegexes: [],
		env: [],
		exclude: [],
	};

	it("should route to ServerScriptService based on suffix", () => {
		const result = resolveRoute(
			"systems/Combat.server.lua",
			false,
			baseContext
		);

		expect(result.targetService).toBe("ServerScriptService");
		expect(result.nodeName).toBe("Combat");
		expect(result.wrapperFolder).toBe("server");
	});

	it("should route to StarterPlayerScripts based on PascalCase suffix", () => {
		const result = resolveRoute(
			"ui/InventoryStarterPlayerScripts.lua",
			false,
			baseContext
		);

		expect(result.targetService).toBe("StarterPlayerScripts");
		expect(result.nodeName).toBe("Inventory");
		expect(result.wrapperFolder).toBe("client");
	});

	it("should route to ReplicatedStorage if no explicit suffix or folder is found", () => {
		const result = resolveRoute("utils/Math.lua", false, baseContext);

		expect(result.targetService).toBe("ReplicatedStorage");
		expect(result.nodeName).toBe("Math");
		expect(result.wrapperFolder).toBe("shared");
	});

	it("should swap extensions to .luau for TypeScript projects", () => {
		const tsContext: RouteContext = {
			...baseContext,
			isTsProject: true,
			build: "out",
		};
		const result = resolveRoute("components/Button.ts", false, tsContext);

		expect(result.projectPath).toBe("out/components/Button.luau");
	});

	it("should handle init files correctly", () => {
		const result = resolveRoute(
			"systems/Combat/init.lua",
			true,
			baseContext
		);

		expect(result.nodeName).toBe("Combat");
		expect(result.projectPath).toBe("src/systems/Combat");
	});

	it("should support custom config aliases for suffixes and overriding default mappings", () => {
		const customContext: RouteContext = {
			...baseContext,
			routingMaps: generateRoutingMaps({
				Controller: "StarterPlayerScripts",
				server: "ReplicatedStorage",
			}),
		};

		const result1 = resolveRoute(
			"ui/PlayerController.lua",
			false,
			customContext
		);
		expect(result1.targetService).toBe("StarterPlayerScripts");
		expect(result1.nodeName).toBe("Player");
		expect(result1.wrapperFolder).toBe("client");

		const result2 = resolveRoute(
			"systems/Combat.server.lua",
			false,
			customContext
		);
		expect(result2.targetService).toBe("ReplicatedStorage");
		expect(result2.nodeName).toBe("Combat");
	});

	it("should retain routing suffixes in nodeName when verbatim is true, except for .server and .client", () => {
		const keepSuffixContext: RouteContext = {
			...baseContext,
			verbatim: true,
		};

		const result1 = resolveRoute(
			"systems/Combat.server.lua",
			false,
			keepSuffixContext
		);
		expect(result1.targetService).toBe("ServerScriptService");
		expect(result1.nodeName).toBe("Combat");
		expect(result1.wrapperFolder).toBe("server");

		const result2 = resolveRoute(
			"systems/Combat_server.lua",
			false,
			keepSuffixContext
		);
		expect(result2.targetService).toBe("ServerScriptService");
		expect(result2.nodeName).toBe("Combat_server");

		const customContext: RouteContext = {
			...keepSuffixContext,
			routingMaps: generateRoutingMaps({
				Controller: "StarterPlayerScripts",
			}),
		};
		const result3 = resolveRoute(
			"ui/PlayerController.lua",
			false,
			customContext
		);
		expect(result3.targetService).toBe("StarterPlayerScripts");
		expect(result3.nodeName).toBe("PlayerController");
	});

	it("should route correctly based on separator prefix", () => {
		const result = resolveRoute(
			"systems/server.Combat.lua",
			false,
			baseContext
		);

		expect(result.targetService).toBe("ServerScriptService");
		expect(result.nodeName).toBe("Combat");
		expect(result.wrapperFolder).toBe("server");
	});

	it("should route correctly based on pascalcase/no-separator prefix", () => {
		const result = resolveRoute(
			"ui/ClientController.ts",
			false,
			baseContext
		);

		expect(result.targetService).toBe("StarterPlayerScripts");
		expect(result.nodeName).toBe("Controller");
		expect(result.wrapperFolder).toBe("client");
	});

	it("should strip both prefix and separator from the node name", () => {
		const result = resolveRoute(
			"systems/server_Combat.lua",
			false,
			baseContext
		);

		expect(result.targetService).toBe("ServerScriptService");
		expect(result.nodeName).toBe("Combat");
		expect(result.wrapperFolder).toBe("server");
	});

	it("should not route when using prefix without a separator", () => {
		const result = resolveRoute(
			"systems/serverside.lua",
			false,
			baseContext
		);

		expect(result.targetService).toBe("ReplicatedStorage");
		expect(result.nodeName).toBe("serverside");
		expect(result.wrapperFolder).toBe("shared");
	});

	it("should not route and keep the name if the filename exactly matches a routing keyword", () => {
		const result = resolveRoute("ui/StarterGui.lua", false, baseContext);

		expect(result.targetService).toBe("ReplicatedStorage");
		expect(result.nodeName).toBe("StarterGui");
		expect(result.wrapperFolder).toBe("shared");
	});
});

describe("Marker File Routing", () => {
	const baseContext: RouteContext = {
		source: "src",
		build: "src",
		output: "test.project.json",
		name: "test-game",
		emitLegacyScripts: true,
		isTsProject: false,
		verbatim: false,
		routingMaps: generateRoutingMaps(),
		directoryMarkers: {},
		environments: new Set(),
		activeEnv: new Set(),
		envRegexes: [],
		env: [],
		exclude: [],
	};

	it("should route based on a root marker file", () => {
		const context: RouteContext = {
			...baseContext,
			directoryMarkers: { "": ["server"] },
		};
		const result = resolveRoute("Combat.lua", false, context);

		expect(result.targetService).toBe("ServerScriptService");
		expect(result.wrapperFolder).toBe("server");
	});

	it("should route based on a directory marker file and preserve the folder name", () => {
		const context: RouteContext = {
			...baseContext,
			directoryMarkers: { AntiCheat: ["server"] },
		};
		const result = resolveRoute("AntiCheat/scanner.lua", false, context);

		expect(result.targetService).toBe("ServerScriptService");
		expect(result.virtualParts).toContain("AntiCheat");
	});

	it("should prioritize file suffix over a directory marker", () => {
		const context: RouteContext = {
			...baseContext,
			directoryMarkers: { network: ["shared"] },
		};
		const result = resolveRoute("network/api.server.lua", false, context);
		expect(result.targetService).toBe("ServerScriptService");
		expect(result.wrapperFolder).toBe("server");
	});

	it("should prioritize directory marker over a routing folder name and strip the folder name", () => {
		const context: RouteContext = {
			...baseContext,
			directoryMarkers: { client: ["server"] },
		};
		const result = resolveRoute("client/main.lua", false, context);

		expect(result.targetService).toBe("ServerScriptService");
		expect(result.virtualParts).not.toContain("client");
	});
});

describe("Routing (Deepest Wins)", () => {
	const baseContext: RouteContext = {
		source: "src",
		build: "src",
		output: "test.project.json",
		name: "test-game",
		emitLegacyScripts: true,
		isTsProject: false,
		verbatim: false,
		routingMaps: generateRoutingMaps(),
		directoryMarkers: {},
		environments: new Set(),
		activeEnv: new Set(),
		envRegexes: [],
		env: [],
		exclude: [],
	};

	it("Deepest folder keyword wins over shallow folder keyword", () => {
		const context: RouteContext = { ...baseContext };
		const result = resolveRoute(
			"client/systems/server/main.lua",
			false,
			context
		);

		expect(result.targetService).toBe("ServerScriptService");
	});

	it("Deep folder marker wins over shallow root marker", () => {
		const context: RouteContext = {
			...baseContext,
			directoryMarkers: { "": ["client"], systems: ["server"] },
		};
		const result = resolveRoute("systems/main.lua", false, context);

		expect(result.targetService).toBe("ServerScriptService");
	});

	it("Folder marker wins over folder keyword", () => {
		const context: RouteContext = {
			...baseContext,
			directoryMarkers: { client: ["server"] },
		};
		const result = resolveRoute("client/main.lua", false, context);

		expect(result.targetService).toBe("ServerScriptService");
	});

	it("File suffix wins over folder marker", () => {
		const context: RouteContext = {
			...baseContext,
			directoryMarkers: { network: ["shared"] },
		};
		const result = resolveRoute("network/api.server.lua", false, context);

		expect(result.targetService).toBe("ServerScriptService");
		expect(result.wrapperFolder).toBe("server");
	});

	it("File suffix wins over folder keyword", () => {
		const context: RouteContext = { ...baseContext };
		const result = resolveRoute(
			"client/ui/button.server.lua",
			false,
			context
		);

		expect(result.targetService).toBe("ServerScriptService");
		expect(result.wrapperFolder).toBe("server");
	});

	it("File prefix wins over root marker", () => {
		const context: RouteContext = {
			...baseContext,
			directoryMarkers: { "": ["client"] },
		};
		const result = resolveRoute("server.combat.lua", false, context);

		expect(result.targetService).toBe("ServerScriptService");
		expect(result.wrapperFolder).toBe("server");
	});

	it("Deepest keyword wins, all keywords are stripped, no virtual parts left", () => {
		const context: RouteContext = { ...baseContext };
		const result = resolveRoute(
			"server/client/shared/test.lua",
			false,
			context
		);

		expect(result.targetService).toBe("ReplicatedStorage");
		expect(result.wrapperFolder).toBe("shared");
		expect(result.virtualParts).toEqual([]);
		expect(result.nodeName).toBe("test");
	});

	it("Deepest keyword wins, standard folders in between are preserved", () => {
		const context: RouteContext = { ...baseContext };
		const result = resolveRoute(
			"server/inventory/shared/test.lua",
			false,
			context
		);

		expect(result.targetService).toBe("ReplicatedStorage");
		expect(result.wrapperFolder).toBe("shared");
		expect(result.virtualParts).toEqual(["inventory"]);
		expect(result.nodeName).toBe("test");
	});
});

describe("Environment Filtering", () => {
	const activeEnv = new Set(["dev", "debug"]);
	const environments = new Set(["dev", "prod", "debug"]);
	const envRegexes = Array.from(activeEnv).map((env) => ({
		suffix: new RegExp(`[\\.\\-_]${env}$`, "i"),
		prefix: new RegExp(`^${env}[\\.\\-_]`, "i"),
		middle: new RegExp(`[\\.\\-_]${env}(?=[\\.\\-_])`, "i"),
	}));

	const envContext: RouteContext = {
		source: "src",
		build: "src",
		output: "test.project.json",
		name: "test-game",
		emitLegacyScripts: true,
		isTsProject: false,
		verbatim: false,
		routingMaps: generateRoutingMaps(),
		directoryMarkers: {},
		environments,
		activeEnv,
		envRegexes,
		env: [],
		exclude: [],
	};

	it("should drop a file if it contains an inactive environment affix", () => {
		const result = resolveRoute("api.prod.lua", false, envContext);
		expect(result.dropped).toBe(true);
	});

	it("should drop a folder if it is named after an inactive environment", () => {
		const result = resolveRoute("prod/api.lua", false, envContext);
		expect(result.dropped).toBe(true);
	});

	it("should keep a file and strip the affix if the environment is active", () => {
		const result = resolveRoute("api.dev.lua", false, envContext);
		expect(result.dropped).toBe(false);
		expect(result.nodeName).toBe("api");
		expect(result.targetService).toBe("ReplicatedStorage");
	});

	it("should keep a file, strip the affix, and apply proper script routing if chained", () => {
		const result = resolveRoute("api.dev.server.lua", false, envContext);
		expect(result.dropped).toBe(false);
		expect(result.nodeName).toBe("api");
		expect(result.targetService).toBe("ServerScriptService");
	});

	it("should handle mixed delimiters when stripping environment tags", () => {
		const result = resolveRoute("api-dev_server.lua", false, envContext);
		expect(result.dropped).toBe(false);
		expect(result.nodeName).toBe("api");
		expect(result.targetService).toBe("ServerScriptService");
	});

	it("should strip multiple chained active environments correctly", () => {
		const result = resolveRoute("core.dev.debug.lua", false, envContext);
		expect(result.dropped).toBe(false);
		expect(result.nodeName).toBe("core");
	});

	it("should keep a file and handle prefix environment stripping", () => {
		const result = resolveRoute("debug-logger.lua", false, envContext);
		expect(result.dropped).toBe(false);
		expect(result.nodeName).toBe("logger");
	});

	it("should keep a folder but strip its name from virtualParts if it matches an active environment", () => {
		const result = resolveRoute(
			"dev/systems/combat.lua",
			false,
			envContext
		);
		expect(result.dropped).toBe(false);
		expect(result.virtualParts).not.toContain("dev");
		expect(result.virtualParts).toContain("systems");
	});

	it("should NOT strip environment tags if they are part of a larger word", () => {
		const result = resolveRoute("device.lua", false, envContext);
		expect(result.dropped).toBe(false);
		expect(result.nodeName).toBe("device"); // 'dev' is inside 'device'
	});

	it("should NOT drop a file if the inactive environment tag is part of a larger word", () => {
		const result = resolveRoute("production.lua", false, envContext);
		expect(result.dropped).toBe(false);
		expect(result.nodeName).toBe("production"); // 'prod' is inactive, but inside 'production'
	});

	it("should NOT drop a folder if the inactive environment tag is part of a larger folder name", () => {
		const result = resolveRoute("production/api.lua", false, envContext);
		expect(result.dropped).toBe(false);
		expect(result.virtualParts).toContain("production");
	});

	it("should safely handle a file named exactly after an active environment", () => {
		const result = resolveRoute("dev.lua", false, envContext);
		expect(result.dropped).toBe(false);
		expect(result.nodeName).toBe("dev");
	});

	it("should drop a folder entirely if it contains an inactive environment marker file", () => {
		const contextWithMarker: RouteContext = {
			...envContext,
			directoryMarkers: { systems: ["prod"] },
		};
		const result = resolveRoute(
			"systems/combat.lua",
			false,
			contextWithMarker
		);
		expect(result.dropped).toBe(true);
	});

	it("should keep a folder if its environment marker file is active", () => {
		const contextWithMarker: RouteContext = {
			...envContext,
			directoryMarkers: { systems: ["dev"] },
		};
		const result = resolveRoute(
			"systems/combat.lua",
			false,
			contextWithMarker
		);
		expect(result.dropped).toBe(false);
		expect(result.virtualParts).toContain("systems");
	});

	it("should process multi-markers (e.g. .dev AND .server) correctly", () => {
		const contextWithMarkers: RouteContext = {
			...envContext,
			directoryMarkers: { api: ["dev", "server"] },
		};
		const result = resolveRoute(
			"api/endpoint.lua",
			false,
			contextWithMarkers
		);

		expect(result.dropped).toBe(false);
		expect(result.targetService).toBe("ServerScriptService");
		expect(result.wrapperFolder).toBe("server");
		expect(result.virtualParts).toContain("api");
	});

	it("should drop a folder entirely if it contains an inactive environment AND a valid routing marker", () => {
		const contextWithMarkers: RouteContext = {
			...envContext,
			directoryMarkers: { api: ["prod", "server"] },
		};
		const result = resolveRoute(
			"api/endpoint.lua",
			false,
			contextWithMarkers
		);

		expect(result.dropped).toBe(true);
	});

	it("should route an environment folder via a marker, but still strip the environment folder name", () => {
		const contextWithMarkers: RouteContext = {
			...envContext,
			directoryMarkers: { dev: ["server"] },
		};
		const result = resolveRoute(
			"dev/endpoint.lua",
			false,
			contextWithMarkers
		);

		expect(result.dropped).toBe(false);
		expect(result.targetService).toBe("ServerScriptService");
		expect(result.wrapperFolder).toBe("server");
		expect(result.virtualParts).not.toContain("dev");
	});

	it("should process a routing folder containing an active environment marker", () => {
		const contextWithMarkers: RouteContext = {
			...envContext,
			directoryMarkers: { server: ["dev"] },
		};
		const result = resolveRoute(
			"server/endpoint.lua",
			false,
			contextWithMarkers
		);

		expect(result.dropped).toBe(false);
		expect(result.targetService).toBe("ServerScriptService");
		expect(result.virtualParts).not.toContain("server");
	});

	it("should respect multi-markers at the root directory level", () => {
		const contextWithMarkers: RouteContext = {
			...envContext,
			directoryMarkers: { "": ["dev", "client"] },
		};
		const result = resolveRoute("main.lua", false, contextWithMarkers);

		expect(result.dropped).toBe(false);
		expect(result.targetService).toBe("StarterPlayerScripts");
		expect(result.wrapperFolder).toBe("client");
	});
});
