"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);
  const isLoginPage = pathname.endsWith("/login");

  useEffect(() => {
    if (isLoginPage) {
      setChecked(true);
      return;
    }
    const token = sessionStorage.getItem("accessToken");
    if (!token) {
      const segments = pathname.split("/");
      const locale = segments[1] ?? "ja";
      window.location.href = `/${locale}/login`;
      return;
    }
    setChecked(true);
  }, [pathname, isLoginPage]);

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return <>{children}</>;
}
