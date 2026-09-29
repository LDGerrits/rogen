import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { containerClassName, parseTarget } from "../roblox.js";

const location = {
	resource: "/repo/default.rogen.json",
	position: { line: 4, column: 15 },
};

describe("domain/roblox/roblox", () => {
	describe("parseTarget", () => {
		it("should read a bare service", () => {
			expect(
				parseTarget("ServerScriptService", location).unwrap()
			).toEqual({ service: "ServerScriptService", folders: [] });
		});

		it("should split a nested target into its service and folders", () => {
			expect(
				parseTarget(
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
				parseTarget("ReplicatedStorage/shared/utils", location).unwrap()
			).toEqual({
				service: "ReplicatedStorage",
				folders: ["shared", "utils"],
			});
		});

		it("should accept TextChatService as a first segment", () => {
			expect(
				parseTarget("TextChatService/Config", location).unwrap()
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
				const result = parseTarget(target, location);

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
