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

	describe("uses", () => {
		it("should say whether a name is taken, by any tool", () => {
			const manifest = parse(
				"/repo/rokit.toml",
				'[tools]\nrojo = "someone/fork@1.0.0"\n'
			);

			expect(manifest.uses("rojo")).toBe(true);
			expect(manifest.uses("wally")).toBe(false);
		});
	});

	describe("pinOf", () => {
		it("should write the entry as the manager's file reads it", () => {
			const rokit = parse("/repo/rokit.toml", "[tools]\n");
			const foreman = parse("/repo/foreman.toml", "[tools]\n");

			expect(rokit.pinOf("rogen", "ldgerrits/rogen", "2.0.3")).toBe(
				'rogen = "ldgerrits/rogen@2.0.3"'
			);
			expect(foreman.pinOf("rogen", "ldgerrits/rogen", "2.0.3")).toBe(
				'rogen = { github = "ldgerrits/rogen", version = "2.0.3" }'
			);
		});

		it("should write what the file's own parser reads back", () => {
			const foreman = parse("/repo/foreman.toml", "[tools]\n");
			const text = `[tools]\n${foreman.pinOf("rogen", "ldgerrits/rogen", "2.0.3")}\n`;

			expect(
				parse("/repo/foreman.toml", text).nameOf("ldgerrits/rogen")
			).toBe("rogen");
		});
	});

	describe("withPin", () => {
		const pinned = (file: string, text: string) =>
			parse(file, text).withPin("rojo", "rojo-rbx/rojo", "7.7.1");

		it("should add the entry after the last one in the tools section", () => {
			expect(
				pinned(
					"/repo/rokit.toml",
					'# tools\n[tools]\nwally = "UpliftGames/wally@0.3.2"\n'
				)
			).toBe(
				'# tools\n[tools]\nwally = "UpliftGames/wally@0.3.2"\nrojo = "rojo-rbx/rojo@7.7.1"\n'
			);
		});

		it("should keep what follows the tools section where it is", () => {
			expect(
				pinned(
					"/repo/rokit.toml",
					'[tools]\nwally = "UpliftGames/wally@0.3.2"\n\n[other]\nx = 1\n'
				)
			).toBe(
				'[tools]\nwally = "UpliftGames/wally@0.3.2"\nrojo = "rojo-rbx/rojo@7.7.1"\n\n[other]\nx = 1\n'
			);
		});

		it("should leave a comment that comes before the next section above it", () => {
			expect(
				pinned(
					"/repo/rokit.toml",
					'[tools]\nwally = "u/w@1.0.0"\n# the rest\n[other]\n'
				)
			).toBe(
				'[tools]\nwally = "u/w@1.0.0"\nrojo = "rojo-rbx/rojo@7.7.1"\n# the rest\n[other]\n'
			);
		});

		it("should start the tools section when there is none", () => {
			expect(pinned("/repo/rokit.toml", "")).toBe(
				'[tools]\nrojo = "rojo-rbx/rojo@7.7.1"\n'
			);
			expect(pinned("/repo/rokit.toml", "# nothing yet")).toBe(
				'# nothing yet\n\n[tools]\nrojo = "rojo-rbx/rojo@7.7.1"\n'
			);
		});

		it("should add to an empty tools section", () => {
			expect(pinned("/repo/rokit.toml", "[tools]\n")).toBe(
				'[tools]\nrojo = "rojo-rbx/rojo@7.7.1"\n'
			);
		});

		it("should end a last entry that has no line break, and keep CRLF line breaks", () => {
			expect(
				pinned("/repo/rokit.toml", '[tools]\r\nwally = "u/w@1.0.0"')
			).toBe(
				'[tools]\r\nwally = "u/w@1.0.0"\r\nrojo = "rojo-rbx/rojo@7.7.1"\r\n'
			);
		});

		it("should write what the file's own parser reads back", () => {
			const text = pinned("/repo/foreman.toml", "[tools]\n");

			expect(
				parse("/repo/foreman.toml", text).nameOf("rojo-rbx/rojo")
			).toBe("rojo");
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
