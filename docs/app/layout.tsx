import type { Metadata } from "next";
import { RootProvider } from "fumadocs-ui/provider/next";
import "./global.css";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import { siteDescription, siteUrl } from "@/lib/shared";

// Self-hosted, so a build never depends on fetching from Google Fonts.
const geistSans = localFont({
	src: "./fonts/geist.woff2",
	weight: "100 900",
	variable: "--font-geist-sans",
});

const geistMono = localFont({
	src: "./fonts/geist-mono.woff2",
	weight: "100 900",
	variable: "--font-geist-mono",
});

export const metadata: Metadata = {
	metadataBase: new URL(siteUrl),
	title: {
		default: "Rogen - Rojo with file-system routing",
		template: "%s | Rogen",
	},
	description: siteDescription,
};

export default function Layout({ children }: LayoutProps<"/">) {
	return (
		<html
			lang="en"
			className={`${geistSans.variable} ${geistMono.variable}`}
			suppressHydrationWarning
		>
			<body className="flex flex-col min-h-screen">
				<RootProvider>{children}</RootProvider>
				<Analytics />
			</body>
		</html>
	);
}
