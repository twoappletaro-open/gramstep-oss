"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "../../components/layout/sidebar";
import { AuthGuard } from "../../components/layout/auth-guard";

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname.endsWith("/login");

  return (
    <AuthGuard>
      {isLoginPage ? (
        children
      ) : (
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 p-6 bg-cream-100 min-h-screen overflow-auto">{children}</main>
        </div>
      )}
    </AuthGuard>
  );
}
