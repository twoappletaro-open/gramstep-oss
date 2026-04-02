"use client";

import { useState } from "react";
import { PackageForm } from "../../../../components/templates/package-form";
import { createApiClient, getApiUrl } from "../../../../lib/api-client";
import type { CreatePackageInput, UpdatePackageInput } from "@gramstep/shared";

export default function NewPackagePage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiUrl = typeof window !== "undefined" ? getApiUrl() : "";
  const accountId = typeof window !== "undefined"
    ? localStorage.getItem("gramstep_account_id") ?? ""
    : "default";

  async function handleSubmit(data: CreatePackageInput | UpdatePackageInput) {
    setLoading(true);
    setError(null);
    const client = createApiClient(apiUrl);
    const result = await client.packages.create(accountId, data as CreatePackageInput);
    if (result.ok) {
      window.location.href = "../templates";
    } else {
      setError(result.error.message);
    }
    setLoading(false);
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-bold text-cobalt-700">パッケージ作成</h1>
      {error && (
        <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <PackageForm onSubmit={handleSubmit} loading={loading} />
    </main>
  );
}
