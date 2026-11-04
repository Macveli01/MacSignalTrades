import "./globals.css";
export const metadata = { title: "MacSignalTrades", description: "Validated ICT / SMC trading signals" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}