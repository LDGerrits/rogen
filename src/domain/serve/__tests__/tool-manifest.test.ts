import { ToolManifest } from "../tool-manifest.js";

const parse = (file: string, text: string) => ToolManifest.parse(file, text)!;

describe("ToolManifest", () => {
	describe("parse", () => {
		it("should read Rokit's and Aftman's owner/repo@version entries", () => {
			const manifest = parse(
				"/repo/rokit.toml",
				'# tools\n[tools]\nrojo = "rojo-rbx/rojo@7.7.1"\nwally = "UpliftGames/wally@0.3.2" # packages\n'
			);

			expect(manifest.nameOf("rojo-rbx/rojo")).toBe("rojo");
			expect(manifest.nameOf("upliftgames/wally")).toBe("wally");
		});

		it("should read Foreman's tables, by source or github", () => {
			const manifest = parse(
				"/repo/foreman.toml",
				'[tools]\nrojo = { source = "rojo-rbx/rojo", version = "7.4.1" }\nargon = { github = "argon-rbx/argon", version = "2.0.0" }\n'
			);

			expect(manifest.nameOf("rojo-rbx/rojo")).toBe("rojo");
			expect(manifest.nameOf("argon-rbx/argon")).toBe("argon");
		});

		it("should give the name a tool runs as, which may differ from the repository's", () => {
			const manifest = parse(
				"/repo/aftman.toml",
				'[tools]\n"rojo7" = "Rojo-Rbx/Rojo@7.7.1"\n'
			);

			expect(manifest.nameOf("rojo-rbx/rojo")).toBe("rojo7");
		});

		it("should read only the tools section", () => {
			const manifest = parse(
				"/repo/rokit.toml",
				'rojo = "rojo-rbx/rojo@7.7.1"\n[other]\nargon = "argon-rbx/argon@2.0.0"\n'
			);

			expect(manifest.nameOf("rojo-rbx/rojo")).toBeUndefined();
			expect(manifest.nameOf("argon-rbx/argon")).toBeUndefined();
		});

		it("should not read a file of another name", () => {
			expect(
				ToolManifest.parse("/repo/wally.toml", "[tools]\n")
			).toBeUndefined();
		});
	});

	describe("commands", () => {
		it("should install and add with the manager the file belongs to", () => {
			const manifest = parse("/repo/aftman.toml", "[tools]\n");

			expect(manifest.installCommand).toBe("aftman install");
			expect(manifest.addCommand("rojo-rbx/rojo")).toBe(
				"aftman add rojo-rbx/rojo"
			);
		});

		it("should have no add command for Foreman, which has none", () => {
			expect(
				parse("/repo/foreman.toml", "[tools]\n").addCommand(
					"rojo-rbx/rojo"
				)
			).toBeUndefined();
		});
	});
});
