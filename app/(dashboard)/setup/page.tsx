import type { Metadata } from "next";
import Link from "next/link";
import { requireSchoolArea } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { orgSetupSteps, setupSteps } from "@/lib/setup";
import { loadOrgSetupCounts, loadSetupCounts } from "@/lib/setup-data";
import { PageHeader } from "@/components/dashboard/page-header";
import { SetupChecklist } from "@/components/dashboard/setup-checklist";

export const metadata: Metadata = { title: "Getting started" };

export default async function SetupPage() {
  const user = await requireSchoolArea("setup");
  const db = await createClient();
  const org = user.schoolKind === "organisation";
  const steps = org ? orgSetupSteps(await loadOrgSetupCounts(db)) : setupSteps(await loadSetupCounts(db));
  return (
    <>
      <PageHeader title="Getting started" description={org ? "Everything your organisation needs before staff start tapping in, in order." : "Everything your school needs before the first morning at the gate, in order."} />
      <div className="max-w-3xl">
        <SetupChecklist steps={steps} schoolName={user.schoolName ?? (org ? "your organisation" : "your school")} />
        <p className="mt-4 text-sm text-muted-foreground">
          Stuck on a step? The <Link href="/help#admin" className="font-medium text-brand hover:underline">first-week guide</Link> walks through each one.
        </p>
      </div>
    </>
  );
}
