import './globals.css'

export const metadata = {
  title: 'proxy-ch · Dashboard',
  description: 'Live traffic monitor for the Swiss forward proxy',
  icons: { icon: '/favicon.svg' },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
