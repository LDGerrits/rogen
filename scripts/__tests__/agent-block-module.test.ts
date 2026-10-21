import { renderAgentBlockModule } from "../generate-agent-block.js";

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
});
