import { z } from "zod";
import { mergeDeep } from "../../base/object.js";
import { ConfigModel } from "./config-models.js";
import { Registry } from "../registry/registry.js";

export const Extensions = {
	Config: "platform.contributions.configuration",
};

export interface ConfigNode {
	id: string;
	schema: z.ZodRawShape;
	defaults: Record<string, unknown>;
}

export interface ConfigRegistry {
	registerConfig(node: ConfigNode): void;
	getConfigModel(): ConfigModel;
	getSchema(): z.ZodType<Record<string, unknown>>;
}

class CoreConfigRegistry implements ConfigRegistry {
	private readonly nodes: ConfigNode[] = [];

	registerConfig(node: ConfigNode): void {
		this.nodes.push(node);
	}

	getConfigModel(): ConfigModel {
		const defaults = this.nodes.reduce(
			(acc, node) =>
				mergeDeep<Record<string, unknown>>(acc, node.defaults),
			{}
		);
		return new ConfigModel(defaults);
	}

	getSchema(): z.ZodType<Record<string, unknown>> {
		const combinedShape = this.nodes.reduce(
			(acc, node) => ({ ...acc, ...node.schema }),
			{} as z.ZodRawShape
		);
		return z.object(combinedShape).catchall(z.unknown());
	}
}

Registry.add(Extensions.Config, new CoreConfigRegistry());
