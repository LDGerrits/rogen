import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { Target, containerClassName } from "../roblox.js";

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
});
