"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TimeText } from "@/components/ui/time-text";
import { apiRequest } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { AdminProfile, AppConfig } from "@/types";
import { ErrorNotice, inputCls, LoadingRow, PageHeader, Panel } from "./primitives";

export function SettingsView() {
  const settings = useApi<{ config: AppConfig; profile: AdminProfile }>("/api/admin/settings");
  return (
    <>
      <PageHeader title="Settings" subtitle="Runtime limits are stored in the database and enforced there." />
      <div className="max-w-3xl space-y-6 p-4 sm:p-8">
        {settings.error && <ErrorNotice message={settings.error.message} onRetry={() => void settings.reload()} />}
        {settings.loading && !settings.data && <LoadingRow />}
        {settings.data && (
          <SettingsForms
            config={settings.data.config}
            profile={settings.data.profile}
            onSaved={() => void settings.reload()}
          />
        )}
      </div>
    </>
  );
}

type Limits = Pick<AppConfig, "message_max_length" | "rate_limit_per_minute" | "sessions_per_hour">;

/** Mounted once data is loaded, so form state initializes directly from props. */
function SettingsForms({ config, profile, onSaved }: { config: AppConfig; profile: AdminProfile; onSaved: () => void }) {
  const [form, setForm] = useState<Limits>({
    message_max_length: config.message_max_length,
    rate_limit_per_minute: config.rate_limit_per_minute,
    sessions_per_hour: config.sessions_per_hour,
  });
  const [name, setName] = useState(profile.display_name);
  const [saving, setSaving] = useState<"config" | "profile" | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const saveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving("config");
    const res = await apiRequest<AppConfig>("/api/admin/settings", { method: "PATCH", body: form });
    setSaving(null);
    setNotice(res.ok ? { kind: "ok", text: "Limits saved. They apply to the next message." } : { kind: "error", text: res.error.message });
    if (res.ok) onSaved();
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving("profile");
    const res = await apiRequest("/api/admin/profile", { method: "PATCH", body: { display_name: name } });
    setSaving(null);
    setNotice(res.ok ? { kind: "ok", text: "Display name saved." } : { kind: "error", text: res.error.message });
  };

  const num = (key: keyof Limits, label: string, min: number, max: number, hint: string) => (
    <div className="space-y-1.5">
      <label htmlFor={key} className="block text-[10px] uppercase tracking-[0.18em] text-faint">
        {label}
      </label>
      <input
        id={key}
        type="number"
        min={min}
        max={max}
        required
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: Number(e.target.value) }))}
        className={`${inputCls} w-40`}
        aria-describedby={`${key}-hint`}
      />
      <p id={`${key}-hint`} className="text-[11px] text-faint">
        {hint} ({min}–{max})
      </p>
    </div>
  );

  return (
    <>
      {notice && (
        <p role={notice.kind === "error" ? "alert" : "status"} className={`text-sm ${notice.kind === "ok" ? "text-neon" : "text-danger"}`}>
          [ {notice.kind === "ok" ? "OK" : "ERROR"} ] {notice.text}
        </p>
      )}

      <Panel title="Abuse protection & limits">
        <form onSubmit={saveConfig} className="space-y-5 p-4">
          <div className="grid gap-5 sm:grid-cols-3">
            {num("message_max_length", "Max message length", 100, 10000, "Characters per message")}
            {num("rate_limit_per_minute", "Messages / minute", 1, 120, "Per user, all sessions")}
            {num("sessions_per_hour", "Sessions / hour", 1, 500, "Per browser identity")}
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-faint">
              Last updated <TimeText iso={config.updated_at} mode="datetime" />
            </p>
            <Button type="submit" variant="primary" disabled={saving === "config"}>
              {saving === "config" ? "Saving…" : "Save limits"}
            </Button>
          </div>
        </form>
      </Panel>

      <Panel title="Your operator profile">
        <form onSubmit={saveProfile} className="space-y-4 p-4">
          <div className="space-y-1.5">
            <label htmlFor="display-name" className="block text-[10px] uppercase tracking-[0.18em] text-faint">
              Display name (internal only)
            </label>
            <input id="display-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className={`${inputCls} w-full sm:w-80`} />
            <p className="text-[11px] text-faint">
              Never shown to visitors — replies always appear as an anonymous incoming transmission.
            </p>
          </div>
          <dl className="grid gap-3 text-[12px] sm:grid-cols-2">
            <div>
              <dt className="text-faint">Email</dt>
              <dd className="text-ink">{profile.email}</dd>
            </div>
            <div>
              <dt className="text-faint">Role</dt>
              <dd className="uppercase text-ink">{profile.role.replace("_", " ")}</dd>
            </div>
          </dl>
          <div className="flex justify-end">
            <Button type="submit" variant="secondary" disabled={saving === "profile"}>
              {saving === "profile" ? "Saving…" : "Save profile"}
            </Button>
          </div>
        </form>
      </Panel>

      <Panel title="Administrator accounts">
        <div className="space-y-2 p-4 text-[12px] leading-relaxed text-muted">
          <p>Accounts are managed from the command line, so the public site has no sign-up endpoint:</p>
          <pre className="overflow-x-auto rounded-sm border border-line bg-void p-3 text-[11px] text-ink">
            npm run admin:create -- --email ops@example.com --password &apos;…&apos; --name &quot;Operator&quot;
          </pre>
          <p>Five failed sign-ins lock an account for 15 minutes. Sessions expire after 12 hours.</p>
        </div>
      </Panel>
    </>
  );
}
