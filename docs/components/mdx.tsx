import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import {
	PreviewGroup,
	PreviewArrow,
	SystemWindow,
	StudioWindow,
	TreeFolder,
	TreeFile,
	TreeService,
	StudioFile,
} from "./file-tree-preview";
import { RouteFigure } from "./route-figure";

export function getMDXComponents(components?: MDXComponents) {
	return {
		...defaultMdxComponents,
		...components,
		PreviewGroup,
		PreviewArrow,
		SystemWindow,
		StudioWindow,
		TreeFolder,
		TreeFile,
		TreeService,
		StudioFile,
		RouteFigure,
	} satisfies MDXComponents;
}

declare global {
	type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
