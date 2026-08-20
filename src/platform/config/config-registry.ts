import { ConfigModel } from "./config-models.js";
import { Registry } from "../registry/registry.js";

export interface JSONSchema {
	type?: string | string[];
	default?: unknown;
	description?: string;
	enum?: unknown[];
	properties?: Record<string, JSONSchema>;
	items?: JSONSchema;
	additionalProperties?: boolean | JSONSchema;
}

export interface ConfigNode {
	id: string;
	title?: string;
	type: "object";
	properties: Record<string, JSONSchema>;
}

export interface ConfigRegistry {
	registerConfig(node: ConfigNode): void;
	getConfigModel(): ConfigModel;
	getJsonSchema(): JSONSchema;
}

class CoreConfigRegistry implements ConfigRegistry {
	private readonly nodes: ConfigNode[] = [];

	registerConfig(node: ConfigNode): void {
		this.nodes.push(node);
	}

	getConfigModel(): ConfigModel {
		const defaults: Record<string, unknown> = {};

		for (const node of this.nodes) {
			for (const [key, schema] of Object.entries(node.properties)) {
				if (schema.default !== undefined) {
					defaults[key] = schema.default;
				}
			}
		}

		return new ConfigModel(defaults);
	}

	getJsonSchema(): JSONSchema {
		const schema: JSONSchema = {
			type: "object",
			properties: {},
			additionalProperties: true,
		};

		for (const node of this.nodes) {
			Object.assign(schema.properties!, node.properties);
		}

		return schema;
	}
}

export const Extensions = {
	Config: "platform.contributions.configuration",
};

Registry.add(Extensions.Config, new CoreConfigRegistry());
