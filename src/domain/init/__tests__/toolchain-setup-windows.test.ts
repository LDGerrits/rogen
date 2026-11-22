import { jest } from "@jest/globals";

jest.unstable_mockModule("../../../base/platform.js", () => ({
	isWindows: true,
	ignoresPathCase: true,
}));

const { ToolchainSetup } = await import("../toolchain-setup.js");
const { directoryOf, planOf } = await import("./init-fixtures.js");

describe("ToolchainSetup on Windows", () => {
	it("should give the PowerShell command that installs Rokit", () => {
		const target = directoryOf();
		const setup = new ToolchainSetup(async () => ({
			rojoReady: false,
			manager: { id: "rokit", installed: false },
		}));

		const planned = planOf(
			setup,
			{ rojoReady: false, manager: { id: "rokit", installed: false } },
			target
		).unwrap();

		expect(planned.nextSteps.setup).toContainEqual(
			"Install Rokit with 'Invoke-RestMethod https://raw.githubusercontent.com/rojo-rbx/rokit/main/scripts/install.ps1 | Invoke-Expression' (https://github.com/rojo-rbx/rokit), then run 'rokit install' here."
		);
	});
});
