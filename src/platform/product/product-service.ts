import { createDecorator } from "../instantiation/instantiation.js";

export const SITE_URL = "https://rogen-roblox.vercel.app";

export const DOCS_URL = `${SITE_URL}/docs/v2`;

export const REPOSITORY = "LDGerrits/rogen";

export const PRODUCT_NAME = "rogen";

export const PACKAGE_NAME = "@ldgerrits/rogen";

export interface ProductService {
	readonly _serviceBrand: undefined;

	readVersion(): Promise<string>;
}

export const ProductService = createDecorator<ProductService>("productService");
