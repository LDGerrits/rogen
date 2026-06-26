const { resolveRoute } = require("../src/core/route");
const { generateRoutingMaps } = require("../src/constants");

describe("Router Logic", () => {
	const baseContext = {
		emitLegacyScripts: true,
		isTsProject: false,
		build: "src",
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
		const tsContext = { ...baseContext, isTsProject: true, build: "out" };
		const result = resolveRoute("components/Button.ts", false, tsContext);
		
		expect(result.projectPath).toBe("out/components/Button.luau");
	});

	it("should handle init files correctly", () => {
		const result = resolveRoute("systems/Combat/init.lua", true, baseContext);
		
		expect(result.nodeName).toBe("Combat");
		expect(result.projectPath).toBe("src/systems/Combat");
	});

	it("should support custom config aliases for suffixes and overriding default mappings", () => {
		const customContext = {
			...baseContext,
			routingMaps: generateRoutingMaps({
				"Controller": "StarterPlayerScripts",
				"server": "ReplicatedStorage"
			})
		};

		// Custom suffix mapping test (PascalCase)
		const result1 = resolveRoute("ui/PlayerController.lua", false, customContext);
		expect(result1.targetService).toBe("StarterPlayerScripts");
		expect(result1.nodeName).toBe("Player");
		expect(result1.wrapperFolder).toBe("client");

		//  Overwritten default mapping test (Separator suffix)
		const result2 = resolveRoute("systems/Combat.server.lua", false, customContext);
		expect(result2.targetService).toBe("ReplicatedStorage");
		expect(result2.nodeName).toBe("Combat");
	});

	it("should retain routing suffixes in nodeName when keepRouteNames is true, except for .server and .client", () => {
		const keepSuffixContext = { ...baseContext, keepRouteNames: true };
		
		// .server (must strip)
		const result1 = resolveRoute("systems/Combat.server.lua", false, keepSuffixContext);
		expect(result1.targetService).toBe("ServerScriptService");
		expect(result1.nodeName).toBe("Combat");
		expect(result1.wrapperFolder).toBe("server");

		// _server (must retain)
		const result2 = resolveRoute("systems/Combat_server.lua", false, keepSuffixContext);
		expect(result2.targetService).toBe("ServerScriptService");
		expect(result2.nodeName).toBe("Combat_server");

		// PascalCase suffix test (must retain)
		const customContext = {
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
	});
});


describe("Marker File Routing", () => {
	const baseContext = {
		emitLegacyScripts: true,
		isTsProject: false,
		build: "src",
		routingMaps: generateRoutingMaps(),
		directoryMarkers: {}
	};

	it("should route based on a root marker file", () => {
		const context = { ...baseContext, directoryMarkers: { "": "server" } };
		const result = resolveRoute("Combat.lua", false, context);
		
		expect(result.targetService).toBe("ServerScriptService");
		expect(result.wrapperFolder).toBe("server");
	});

	it("should route based on a directory marker file and preserve the folder name", () => {
		const context = { ...baseContext, directoryMarkers: { "AntiCheat": "server" } };
		const result = resolveRoute("AntiCheat/scanner.lua", false, context);
		
		expect(result.targetService).toBe("ServerScriptService");
		// The folder "AntiCheat" should be preserved in the tree because it didn't trigger the route
		expect(result.virtualParts).toContain("AntiCheat");
	});

	it("should prioritize file suffix over a directory marker", () => {
		const context = { ...baseContext, directoryMarkers: { "network": "shared" } };
		const result = resolveRoute("network/api.server.lua", false, context);
		
		// The file suffix now overrides the folder marker, forcing it to the server
		expect(result.targetService).toBe("ServerScriptService");
		expect(result.wrapperFolder).toBe("server"); 
	});

	it("should prioritize directory marker over a routing folder name and strip the folder name", () => {
		const context = { ...baseContext, directoryMarkers: { "client": "server" } };
		const result = resolveRoute("client/main.lua", false, context);
		
		expect(result.targetService).toBe("ServerScriptService");
		// Because "client" is a routing keyword, it should be stripped, even though a marker set the route!
		expect(result.virtualParts).not.toContain("client");
	});
});