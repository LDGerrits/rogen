import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { abs } from "../../write/__tests__/fixtures.js";
import { ConfigEdits } from "../config-edits.js";
import { MirrorWorkspace } from "../mirror-workspace.js";

describe("ConfigEdits", () => {
	const file = abs("src/Combat/init.meta.json");

	const edits = () =>
		new ConfigEdits(
			{
				request: {},
				isIgnored: () => false,
			} as unknown as MirrorWorkspace,
			new MemoryFileSystemService()
		);

	describe("metaWrite", () => {
		it("should make no meta file only to take keys off it", () => {
			expect(
				edits().metaWrite({ file }, "ServerScriptService/Combat", {
					attributes: undefined,
				})
			).toBeUndefined();
		});

		it("should write nothing when taking off a key the meta file does not have", () => {
			expect(
				edits().metaWrite(
					{ file, text: '{"attributes":{"Owner":"me"}}' },
					"ServerScriptService/Combat",
					{ properties: undefined }
				)
			).toBeUndefined();
		});
	});
});
