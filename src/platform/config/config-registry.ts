import { z } from "zod";
import { mergeDeep } from "../../base/object.js";
import { ConfigurationModel } from "./config-models.js";
import { Registry } from "../registry/registry.js";

export const Extensions = {
	Configuration: "platform.contributions.configuration",
};

export interface IConfigurationNode {
	id: string;
	schema: z.ZodRawShape;
	defaults: Record<string, unknown>;
}

export interface IConfigurationRegistry {
	registerConfiguration(node: IConfigurationNode): void;
	getConfigurationModel(): ConfigurationModel;
	getSchema(): z.ZodType<Record<string, unknown>>;
}

class ConfigurationRegistry implements IConfigurationRegistry {
	private readonly nodes: IConfigurationNode[] = [];

	registerConfiguration(node: IConfigurationNode): void {
		this.nodes.push(node);
	}

	getConfigurationModel(): ConfigurationModel {
		const defaults = this.nodes.reduce(
			(acc, node) =>
				mergeDeep<Record<string, unknown>>(acc, node.defaults),
			{}
		);
		return new ConfigurationModel(defaults);
	}

	getSchema(): z.ZodType<Record<string, unknown>> {
		const combinedShape = this.nodes.reduce(
			(acc, node) => ({ ...acc, ...node.schema }),
			{} as z.ZodRawShape
		);
		return z.object(combinedShape).catchall(z.unknown());
	}
}

Registry.add(Extensions.Configuration, new ConfigurationRegistry());
