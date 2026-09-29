import { createServiceIdentifier } from "../instantiation/instantiation.js";

/** Facts about the installed program. */
export interface ProductService {
	readonly _serviceBrand: undefined;

	/** The installed version, or `unknown` when it can't be read. */
	getVersion(): Promise<string>;
}

export const ProductService =
	createServiceIdentifier<ProductService>("productService");
