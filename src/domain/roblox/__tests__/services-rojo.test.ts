import fs from "fs";
import path from "path";
import {
	SourcemapNode,
	describeWithRojo,
	makeRojoDir,
	sourcemap,
} from "../../rojo/__tests__/rojo-cli.js";
import { SUPPORTED_SERVICES } from "../services.js";

describeWithRojo("supported services against Rojo", () => {
	let dir: string;

	beforeEach(() => {
		dir = makeRojoDir("rogen-services-");
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("should have Rojo place every service as its own class", () => {
		const tree: Record<string, unknown> = { $className: "DataModel" };
		for (const service of SUPPORTED_SERVICES) {
			tree[service] = { Holder: { $className: "Folder" } };
		}
		fs.writeFileSync(
			path.join(dir, "default.project.json"),
			JSON.stringify({ name: "services", tree })
		);

		const placed = sourcemap(dir, "default.project.json");

		const classes = Object.fromEntries(
			(placed.children ?? []).map((child: SourcemapNode) => [
				child.name,
				child.className,
			])
		);
		expect(Object.keys(classes).sort()).toEqual([...SUPPORTED_SERVICES]);
		for (const service of SUPPORTED_SERVICES) {
			expect(classes[service]).toBe(service);
		}
	});

	it("should have Rojo reject a service it can't write to", () => {
		fs.writeFileSync(
			path.join(dir, "default.project.json"),
			JSON.stringify({
				name: "services",
				tree: { $className: "DataModel", AnimatedImageService: {} },
			})
		);

		expect(() => sourcemap(dir, "default.project.json")).toThrow();
	});
});
