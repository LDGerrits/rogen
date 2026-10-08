import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import {
	InstanceReference,
	Target,
	WHERE_SCRIPTS_RUN,
	containerClassName,
	requireExpression,
	scriptFate,
	whyNotRequirable,
} from "../roblox.js";

const location = {
	resource: "/repo/default.rogen.json",
	position: { line: 4, column: 15 },
};

describe("domain/roblox/roblox", () => {
	describe("Target.parse", () => {
		it("should read a bare service", () => {
			expect(
				Target.parse("ServerScriptService", location).unwrap()
			).toEqual({ service: "ServerScriptService", folders: [] });
		});

		it("should split a nested target into its service and folders", () => {
			expect(
				Target.parse(
					"StarterPlayer/StarterPlayerScripts",
					location
				).unwrap()
			).toEqual({
				service: "StarterPlayer",
				folders: ["StarterPlayerScripts"],
			});
		});

		it("should keep every folder below the service", () => {
			expect(
				Target.parse(
					"ReplicatedStorage/shared/utils",
					location
				).unwrap()
			).toEqual({
				service: "ReplicatedStorage",
				folders: ["shared", "utils"],
			});
		});

		it("should accept TextChatService as a first segment", () => {
			expect(
				Target.parse("TextChatService/Config", location).unwrap()
			).toEqual({ service: "TextChatService", folders: ["Config"] });
		});

		it.each([
			"Server",
			"StarterPlayerScripts",
			"replicatedstorage",
			"CoreGui",
			"ReplicatedStorge",
			"",
		])(
			"should reject %j as a first segment that is not a supported service",
			(target) => {
				const result = Target.parse(target, location);

				expect(result.isErr() && result.error).toEqual([
					{
						severity: DiagnosticSeverity.Error,
						code: "roblox.unsupportedService",
						message: expect.stringContaining(`"${target}"`),
						...location,
					},
				]);
			}
		);
	});

	describe("Target", () => {
		it.each([
			["ReplicatedStorge/Shared", "ReplicatedStorage/Shared"],
			["replicatedstorage", "ReplicatedStorage"],
			[
				"StarterPlayerScripts/Hud",
				"StarterPlayer/StarterPlayerScripts/Hud",
			],
			["StarterPlayerScript", "StarterPlayer/StarterPlayerScripts"],
			[
				"startercharacterscripts",
				"StarterPlayer/StarterCharacterScripts",
			],
		])("should suggest a supported service for %j", (text, suggestion) => {
			const result = Target.parse(text, location);

			expect(result.isErr() && result.error[0].message).toContain(
				`Did you mean "${suggestion}"?`
			);
		});

		it("should name the instance it points at", () => {
			const target = Target.parse(
				"ReplicatedStorage/shared/utils",
				location
			).unwrap();

			expect(target.instancePath).toEqual([
				"ReplicatedStorage",
				"shared",
				"utils",
			]);
			expect(target.toString()).toBe("ReplicatedStorage/shared/utils");
		});

		it.each([
			["StarterPlayer/StarterPlayerScripts", true],
			["StarterPlayer/StarterCharacterScripts/Nested", true],
			["StarterPlayer", false],
			["StarterPlayer/Other", false],
			["ReplicatedStorage/StarterPlayerScripts", false],
		])(
			"should say whether %s holds player scripts: %s",
			(text, expected) => {
				expect(
					Target.parse(text, location).unwrap().isPlayerScripts
				).toBe(expected);
			}
		);
	});

	describe("containerClassName", () => {
		it("should give a service its own class", () => {
			expect(containerClassName(["Workspace"])).toBe("Workspace");
		});

		it("should give StarterPlayer's script containers their own class", () => {
			expect(
				containerClassName(["StarterPlayer", "StarterCharacterScripts"])
			).toBe("StarterCharacterScripts");
		});

		it("should make anything else a Folder", () => {
			expect(containerClassName(["ReplicatedStorage", "shared"])).toBe(
				"Folder"
			);
			expect(
				containerClassName([
					"ReplicatedStorage",
					"StarterPlayerScripts",
				])
			).toBe("Folder");
		});
	});

	describe("InstanceReference", () => {
		const parse = (text: string) => InstanceReference.parse(text)?.text;

		it("should read a dotted path as Studio prints it", () => {
			expect(parse("ServerScriptService.Inventory.Save")).toBe(
				"ServerScriptService.Inventory.Save"
			);
		});

		it("should read a slashed path", () => {
			expect(
				InstanceReference.parse("ServerScriptService/Inventory/Save")
			).toMatchObject({
				text: "ServerScriptService/Inventory/Save",
				separator: "/",
			});
		});

		it("should drop a leading game and everything from the line number on", () => {
			expect(
				parse(
					"game.ServerScriptService.Inventory.Save:12: attempt to index nil"
				)
			).toBe("ServerScriptService.Inventory.Save");
		});

		it("should take the name from a quoted stack frame", () => {
			expect(
				parse("Script 'ServerScriptService.Inventory.Save', Line 12")
			).toBe("ServerScriptService.Inventory.Save");
		});

		it("should not read a path that doesn't start with a service", () => {
			expect(parse("src/Inventory/Save.luau")).toBeUndefined();
			expect(parse("Inventory.Save")).toBeUndefined();
		});

		it("should contain the instance itself and what's inside it, not a longer name", () => {
			const reference = InstanceReference.parse(
				"ServerScriptService.Inventory"
			)!;

			expect(
				reference.contains(["ServerScriptService", "Inventory"])
			).toBe(true);
			expect(
				reference.contains(["ServerScriptService", "Inventory", "Save"])
			).toBe(true);
			expect(
				reference.contains(["ServerScriptService", "InventoryData"])
			).toBe(false);
		});

		it("should match a name that holds a dot", () => {
			expect(
				InstanceReference.parse(
					"ReplicatedStorage.Shared.Types.shared"
				)!.contains(["ReplicatedStorage", "Shared", "Types.shared"])
			).toBe(true);
		});
	});
});

describe("scriptFate", () => {
	it("should run a Script in ServerScriptService and a LocalScript in a player container", () => {
		expect(scriptFate("Script", ["ServerScriptService", "A"])).toBe("runs");
		expect(
			scriptFate("LocalScript", ["StarterPlayer", "StarterPlayerScripts"])
		).toBe("runs");
	});

	it("should keep any script in ServerStorage as stored, not dead", () => {
		expect(scriptFate("Script", ["ServerStorage", "A"])).toBe("stored");
		expect(scriptFate("Server", ["ServerStorage", "A"])).toBe("stored");
	});

	it("should say a script never runs where Roblox doesn't run it", () => {
		expect(scriptFate("Script", ["ReplicatedStorage", "A"])).toBe(
			"neverRuns"
		);
		expect(scriptFate("Client", ["ServerScriptService", "A"])).toBe(
			"neverRuns"
		);
	});
});

describe("WHERE_SCRIPTS_RUN", () => {
	it("should name every service where each kind of script runs", () => {
		expect(WHERE_SCRIPTS_RUN).toBe(
			"A Script runs in ServerScriptService or Workspace, and a LocalScript in StarterPlayerScripts, StarterCharacterScripts, StarterGui, StarterPack or ReplicatedFirst. A Script with RunContext Client never runs in ServerScriptService, which clients can't see."
		);
	});
});

describe("whyNotRequirable", () => {
	it.each([
		[
			["StarterPlayer", "StarterPlayerScripts", "Net", "Http"],
			"StarterPlayerScripts is cloned into each player",
		],
		[
			["StarterPlayer", "StarterCharacterScripts", "Animate"],
			"StarterCharacterScripts is cloned into each character",
		],
		[["StarterGui", "Hud"], "StarterGui is cloned into each player"],
		[["StarterPack", "Tool"], "StarterPack is cloned into each player"],
	])("should say why %j has none", (path, reason) => {
		expect(whyNotRequirable(path)).toBe(reason);
	});

	it("should say nothing elsewhere", () => {
		expect(
			whyNotRequirable(["StarterPlayer", "Shared", "X"])
		).toBeUndefined();
		expect(whyNotRequirable(["ReplicatedStorage", "X"])).toBeUndefined();
	});
});

describe("requireExpression", () => {
	it("should reach a service with GetService and the rest by name", () => {
		expect(
			requireExpression([
				"ReplicatedStorage",
				"Shared",
				"Inventory",
				"Types",
			])
		).toBe('game:GetService("ReplicatedStorage").Shared.Inventory.Types');
	});

	it("should write a name that isn't an identifier as an index", () => {
		expect(
			requireExpression(["ReplicatedStorage", "Foo Bar", "3D", "a.b"])
		).toBe('game:GetService("ReplicatedStorage")["Foo Bar"]["3D"]["a.b"]');
	});

	it("should write a reserved word as an index", () => {
		expect(requireExpression(["ReplicatedStorage", "end"])).toBe(
			'game:GetService("ReplicatedStorage")["end"]'
		);
		expect(requireExpression(["ReplicatedStorage", "ending"])).toBe(
			'game:GetService("ReplicatedStorage").ending'
		);
	});

	it("should escape a quote in a name", () => {
		expect(requireExpression(["ReplicatedStorage", 'a"b'])).toBe(
			'game:GetService("ReplicatedStorage")["a\\"b"]'
		);
	});

	it("should reach a service itself", () => {
		expect(requireExpression(["ReplicatedStorage"])).toBe(
			'game:GetService("ReplicatedStorage")'
		);
	});

	it.each([
		["StarterPlayer", "StarterPlayerScripts", "Net", "Http"],
		["StarterPlayer", "StarterCharacterScripts", "Animate"],
		["StarterGui", "Hud"],
		["StarterPack", "Tool"],
	])(
		"should give none under %s, which Roblox clones at runtime",
		(...path) => {
			expect(requireExpression(path)).toBeUndefined();
		}
	);

	it("should still reach the rest of StarterPlayer", () => {
		expect(requireExpression(["StarterPlayer", "Shared", "X"])).toBe(
			'game:GetService("StarterPlayer").Shared.X'
		);
	});
});
