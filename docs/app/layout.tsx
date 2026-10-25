import { RootProvider } from "fumadocs-ui/provider/next";
import "./global.css";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";

const geistSans = Geist({
	subsets: ["latin"],
	variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
	subsets: ["latin"],
	variable: "--font-geist-mono",
});

export default function Layout({ children }: LayoutProps<"/">) {
	return (
		<html
			lang="en"
			className={`${geistSans.variable} ${geistMono.variable} dark`}
			suppressHydrationWarning
		>
			<body className="flex flex-col min-h-screen">
				<RootProvider
					theme={{
						enabled: false,
						defaultTheme: "dark",
						enableSystem: false,
					}}
				>
					{children}
				</RootProvider>
				<Analytics />
			</body>
		</html>
	);
}
