import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { RouteFigure } from "./route-figure";

export function getMDXComponents(components?: MDXComponents) {
	return {
		...defaultMdxComponents,
		...components,
		RouteFigure,
	} satisfies MDXComponents;
}

declare global {
	type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
