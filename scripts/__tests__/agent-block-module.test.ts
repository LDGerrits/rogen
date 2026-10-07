import fs from "fs";
import {
	OUTPUT,
	currentAgentBlockModule,
	renderAgentBlockModule,
} from "../generate-agent-block.js";

describe("scripts/generate-agent-block", () => {
	it("should embed the block with its markers", () => {
		expect(
			renderAgentBlockModule(
				"---\nname: x\n---\n\n<!-- rogen -->\n## Rogen\n<!-- /rogen -->\n"
			)
		).toContain(
			JSON.stringify("<!-- rogen -->\n## Rogen\n<!-- /rogen -->\n")
		);
	});

	it("should refuse a skill without the block", () => {
		expect(() => renderAgentBlockModule("## Rogen\n")).toThrow();
	});

	it("should have generated the module from the current skill", () => {
		expect(fs.readFileSync(OUTPUT, "utf8")).toBe(currentAgentBlockModule());
	});
});
