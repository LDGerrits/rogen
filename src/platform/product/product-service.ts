import { createServiceIdentifier } from "../instantiation/instantiation.js";

/** Where this release's documentation lives; every link the CLI prints starts here. */
export const DOCS_URL = "https://rogen-playfully.vercel.app/docs/v2";

/** The GitHub repository Rogen is published from, whose releases the binaries come from. */
export const REPOSITORY = "LDGerrits/rogen";

/** The package Rogen is published as on npm. */
export const PACKAGE_NAME = "@ldgerrits/rogen";

/** Facts about the installed program. */
export interface ProductService {
	readonly _serviceBrand: undefined;

	/** The installed version, or `unknown` when it can't be read. */
	readVersion(): Promise<string>;
}

export const ProductService =
	createServiceIdentifier<ProductService>("productService");
