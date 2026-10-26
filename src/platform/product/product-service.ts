import { createServiceIdentifier } from "../instantiation/instantiation.js";

/** Where this release's documentation lives; every link the CLI prints starts here. */
export const DOCS_URL = "https://rogen-roblox.vercel.app/docs/v2";

export const REPOSITORY = "LDGerrits/rogen";

export const PACKAGE_NAME = "@ldgerrits/rogen";

export interface ProductService {
	readonly _serviceBrand: undefined;

	readVersion(): Promise<string>;
}

export const ProductService =
	createServiceIdentifier<ProductService>("productService");
