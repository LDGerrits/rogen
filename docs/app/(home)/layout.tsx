import type { ReactNode } from "react";
import type { IconType } from "react-icons";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { baseOptions } from "@/lib/layout.shared";
import { RiTwitterXLine } from "react-icons/ri";
import { FaDiscord, FaGithub } from "react-icons/fa";

const socials: readonly { label: string; url: string; icon: IconType }[] = [
	{
		label: "GitHub",
		url: "https://github.com/LDGerrits/rogen",
		icon: FaGithub,
	},
	{
		label: "Discord",
		url: "https://discord.com/channels/385151591524597761/1503801029232295996",
		icon: FaDiscord,
	},
	{
		label: "Twitter",
		url: "https://x.com/playfullygames",
		icon: RiTwitterXLine,
	},
];

export default function Layout({ children }: { children: ReactNode }) {
	const base = baseOptions();

	return (
		<HomeLayout
			{...base}
			className="home"
			links={[
				{
					text: "Docs",
					url: "/docs/v2",
					active: "nested-url",
				},
				{
					type: "custom",
					children: (
						<div className="ml-4 flex items-center gap-1">
							{socials.map(({ label, url, icon: Icon }) => (
								<a
									key={label}
									href={url}
									target="_blank"
									rel="noopener noreferrer"
									title={label}
									aria-label={label}
									className="grid size-8 place-items-center text-stone-500 transition-colors duration-200 hover:text-paper"
								>
									<Icon className="size-4" />
								</a>
							))}
						</div>
					),
				},
			]}
		>
			{children}
		</HomeLayout>
	);
}
