import AppSidebar from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export default function ChatLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <SidebarProvider>
      <AppSidebar />

      <SidebarInset>
        <header className="h-16 flex items-center px-4 absolute">
          <SidebarTrigger className="-ml-1 z-10" />
        </header>

        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
