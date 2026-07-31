import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions } from "@/lib/layout.shared";

export default function Layout({ children }: LayoutProps<"/docs">) {
	return (
		<DocsLayout
			tree={source.getPageTree()}
			{...baseOptions()}
			tabs={[
				{
					title: "v2",
					description: "Coming Soon",
					url: "/docs/v2",
				},
				{
					title: "v1",
					description: "The latest release",
					url: "/docs/v1",
				},
			]}
		>
			{children}
		</DocsLayout>
	);
}
