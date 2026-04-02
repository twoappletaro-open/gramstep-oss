"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PackageForm } from "../../../../components/templates/package-form";
import { createApiClient, getApiUrl } from "../../../../lib/api-client";
import type { CreatePackageInput, PackageButton, UpdatePackageInput } from "@gramstep/shared";

type PackageDetail = {
  id: string;
  name: string;
  text: string;
  buttons: PackageButton[];
  is_active: boolean;
  version: number;
};

export default function EditPackagePage() {
  const params = useParams();
  const id = params.id as string;

  const [pkg, setPkg] = useState<PackageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiUrl = typeof window !== "undefined" ? getApiUrl() : "";

  useEffect(() => {
    async function load() {
      const client = createApiClient(apiUrl);
      const result = await client.packages.get(id);
      if (result.ok) {
        setPkg(result.value as PackageDetail);
      } else {
        setError(result.error.message);
      }
      setLoading(false);
    }
    void load();
  }, [apiUrl, id]);

  async function handleSubmit(data: CreatePackageInput | UpdatePackageInput) {
    setSaving(true);
    setError(null);
    const client = createApiClient(apiUrl);
    const result = await client.packages.update(id, data as UpdatePackageInput);
    if (result.ok) {
      window.location.href = "../../templates";
    } else {
      setError(result.error.message);
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p className="text-muted-foreground">読み込み中...</p>
      </main>
    );
  }

  if (!pkg) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p className="text-destructive">{error ?? "パッケージが見つかりません"}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-bold text-cobalt-700">パッケージ編集</h1>
      {error && (
        <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <PackageForm initialData={pkg} onSubmit={handleSubmit} loading={saving} />
    </main>
  );
}
