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
		fullNames: false,
		routingMaps: generateRoutingMaps()
	};

	it("should route to ServerScriptService based on suffix", () => {
		const result = resolveRoute("systems/Combat.server.lua", false, baseContext);
		
		expect(result.targetService).toBe("ServerScriptService");
		expect(result.nodeName).toBe("Combat");
		expect(result.wrapperFolder).toBe("server");
	});

	it("should route to StarterPlayerScripts based on PascalCase suffix", () => {
		const result = resolveRoute("ui/InventoryStarterPlayerScripts.lua", false, baseContext);
		
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
		const tsContext: RouteContext = { ...baseContext, isTsProject: true, build: "out" };
		const result = resolveRoute("components/Button.ts", false, tsContext);
		
		expect(result.projectPath).toBe("out/components/Button.luau");
	});

	it("should handle init files correctly", () => {
		const result = resolveRoute("systems/Combat/init.lua", true, baseContext);
		
		expect(result.nodeName).toBe("Combat");
		expect(result.projectPath).toBe("src/systems/Combat");
	});

	it("should support custom config aliases for suffixes and overriding default mappings", () => {
		const customContext: RouteContext = {
			...baseContext,
			routingMaps: generateRoutingMaps({
				"Controller": "StarterPlayerScripts",
				"server": "ReplicatedStorage"
			})
		};

		const result1 = resolveRoute("ui/PlayerController.lua", false, customContext);
		expect(result1.targetService).toBe("StarterPlayerScripts");
		expect(result1.nodeName).toBe("Player");
		expect(result1.wrapperFolder).toBe("client");

		const result2 = resolveRoute("systems/Combat.server.lua", false, customContext);
		expect(result2.targetService).toBe("ReplicatedStorage");
		expect(result2.nodeName).toBe("Combat");
	});

	it("should retain routing suffixes in nodeName when fullNames is true, except for .server and .client", () => {
		const keepSuffixContext: RouteContext = { ...baseContext, fullNames: true };
		
		const result1 = resolveRoute("systems/Combat.server.lua", false, keepSuffixContext);
		expect(result1.targetService).toBe("ServerScriptService");
		expect(result1.nodeName).toBe("Combat");
		expect(result1.wrapperFolder).toBe("server");

		const result2 = resolveRoute("systems/Combat_server.lua", false, keepSuffixContext);
		expect(result2.targetService).toBe("ServerScriptService");
		expect(result2.nodeName).toBe("Combat_server");

		const customContext: RouteContext = {
			...keepSuffixContext,
			routingMaps: generateRoutingMaps({ "Controller": "StarterPlayerScripts" })
		};
		const result3 = resolveRoute("ui/PlayerController.lua", false, customContext);
		expect(result3.targetService).toBe("StarterPlayerScripts");
		expect(result3.nodeName).toBe("PlayerController");
	});

	it("should route correctly based on separator prefix", () => {
		const result = resolveRoute("systems/server.Combat.lua", false, baseContext);
		
		expect(result.targetService).toBe("ServerScriptService");
		expect(result.nodeName).toBe("Combat");
		expect(result.wrapperFolder).toBe("server");
	});

	it("should route correctly based on pascalcase/no-separator prefix", () => {
		const result = resolveRoute("ui/ClientController.ts", false, baseContext);
		
		expect(result.targetService).toBe("StarterPlayerScripts");
		expect(result.nodeName).toBe("Controller");
		expect(result.wrapperFolder).toBe("client");
	});

	it("should strip both prefix and separator from the node name", () => {
		const result = resolveRoute("systems/server_Combat.lua", false, baseContext);
		
		expect(result.targetService).toBe("ServerScriptService");
		expect(result.nodeName).toBe("Combat");
		expect(result.wrapperFolder).toBe("server");
	});

	it("should not route when using prefix without a separator", () => {
		const result = resolveRoute("systems/serverside.lua", false, baseContext);
		
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
		fullNames: false,
		routingMaps: generateRoutingMaps(),
		directoryMarkers: {}
	};

	it("should route based on a root marker file", () => {
		const context: RouteContext = { ...baseContext, directoryMarkers: { "": "server" } };
		const result = resolveRoute("Combat.lua", false, context);
		
		expect(result.targetService).toBe("ServerScriptService");
		expect(result.wrapperFolder).toBe("server");
	});

	it("should route based on a directory marker file and preserve the folder name", () => {
		const context: RouteContext = { ...baseContext, directoryMarkers: { "AntiCheat": "server" } };
		const result = resolveRoute("AntiCheat/scanner.lua", false, context);
		
		expect(result.targetService).toBe("ServerScriptService");
		expect(result.virtualParts).toContain("AntiCheat");
	});

	it("should prioritize file suffix over a directory marker", () => {
		const context: RouteContext = { ...baseContext, directoryMarkers: { "network": "shared" } };
		const result = resolveRoute("network/api.server.lua", false, context);
		expect(result.targetService).toBe("ServerScriptService");
		expect(result.wrapperFolder).toBe("server"); 
	});

	it("should prioritize directory marker over a routing folder name and strip the folder name", () => {
		const context: RouteContext = { ...baseContext, directoryMarkers: { "client": "server" } };
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
		fullNames: false,
		routingMaps: generateRoutingMaps(),
		directoryMarkers: {}
	};

	it("Deepest folder keyword wins over shallow folder keyword", () => {
		const context: RouteContext = { ...baseContext };
		const result = resolveRoute("client/systems/server/main.lua", false, context);
		
		expect(result.targetService).toBe("ServerScriptService");
	});

	it("Deep folder marker wins over shallow root marker", () => {
		const context: RouteContext = { 
			...baseContext, 
			directoryMarkers: { "": "client", "systems": "server" } 
		};
		const result = resolveRoute("systems/main.lua", false, context);
		
		expect(result.targetService).toBe("ServerScriptService");
	});

	it("Folder marker wins over folder keyword", () => {
		const context: RouteContext = { ...baseContext, directoryMarkers: { "client": "server" } };
		const result = resolveRoute("client/main.lua", false, context);
		
		expect(result.targetService).toBe("ServerScriptService");
	});

	it("File suffix wins over folder marker", () => {
		const context: RouteContext = { ...baseContext, directoryMarkers: { "network": "shared" } };
		const result = resolveRoute("network/api.server.lua", false, context);
		
		expect(result.targetService).toBe("ServerScriptService");
		expect(result.wrapperFolder).toBe("server");
	});

	it("File suffix wins over folder keyword", () => {
		const context: RouteContext = { ...baseContext };
		const result = resolveRoute("client/ui/button.server.lua", false, context);
		
		expect(result.targetService).toBe("ServerScriptService");
		expect(result.wrapperFolder).toBe("server");
	});

	it("File prefix wins over root marker", () => {
		const context: RouteContext = { ...baseContext, directoryMarkers: { "": "client" } };
		const result = resolveRoute("server.combat.lua", false, context);
		
		expect(result.targetService).toBe("ServerScriptService");
		expect(result.wrapperFolder).toBe("server");
	});

	it("Deepest keyword wins, all keywords are stripped, no virtual parts left", () => {
		const context: RouteContext = { ...baseContext };
		const result = resolveRoute("server/client/shared/test.lua", false, context);
		
		expect(result.targetService).toBe("ReplicatedStorage");
		expect(result.wrapperFolder).toBe("shared");
		expect(result.virtualParts).toEqual([]);
		expect(result.nodeName).toBe("test");
	});

	it("Deepest keyword wins, standard folders in between are preserved", () => {
		const context: RouteContext = { ...baseContext };
		const result = resolveRoute("server/inventory/shared/test.lua", false, context);
		
		expect(result.targetService).toBe("ReplicatedStorage");
		expect(result.wrapperFolder).toBe("shared");
		expect(result.virtualParts).toEqual(["inventory"]);
		expect(result.nodeName).toBe("test");
	});
});