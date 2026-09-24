import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { parseTarget } from "../target.js";

const location = {
	resource: "/repo/default.rogen.json",
	position: { line: 4, column: 15 },
};

describe("domain/roblox/target", () => {
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

		it("should accept a service that used to be missing", () => {
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
});
