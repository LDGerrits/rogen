import { RojoNode } from "../rojo/rojo-project.js";

const BASEPLATE: Partial<RojoNode> = {
	$className: "Part",
	$properties: {
		Anchored: true,
		Color: { Color3uint8: [99, 95, 99] },
		Locked: true,
		Position: [0, -10, 0],
		Size: [512, 20, 512],
	},
};

export class SampleGame {
	nodes(): Record<string, Partial<RojoNode>> {
		return {
			Lighting: {
				$properties: {
					Ambient: [0, 0, 0],
					Brightness: 2,
					GlobalShadows: true,
					Outlines: false,
					Technology: "Voxel",
				},
			},
			SoundService: { $properties: { RespectFilteringEnabled: true } },
			Workspace: {
				$properties: { FilteringEnabled: true },
				Baseplate: BASEPLATE,
			},
		};
	}
}
