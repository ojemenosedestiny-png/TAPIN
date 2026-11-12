/** Plain-English names for audit log actions, grouped for the filter. */
export const AUDIT_GROUPS: Record<string, { label: string; actions: Record<string, string> }> = {
  cards: {
    label: "Cards",
    actions: {
      "card.link": "Linked a card", "card.reassign": "Reassigned a card", "card.verify": "Verified a card",
      "card.block": "Blocked a card", "card.unblock": "Unblocked a card", "card.undo": "Undid a card link",
    },
  },
  students: {
    label: "Students and guardians",
    actions: {
      "student.create": "Added a student", "student.update": "Edited a student", "student.import": "Imported students from Excel",
      "guardian.link": "Added a guardian", "guardian.unlink": "Removed a guardian", "guardian.channel": "Changed how a guardian gets alerts",
      "photo.set": "Changed a photo", "photo.bulk_set": "Uploaded photos in bulk",
      "consent.record": "Recorded parental consent", "consent.withdraw": "Withdrew parental consent",
      "excusal.add": "Excused an absence", "excusal.remove": "Removed an excusal",
      "release.allow": "Allowed an early release", "release.sign_out": "Signed someone out early", "release.cancel": "Cancelled an early release",
      "retention.delete": "Deleted leavers' records (retention)",
    },
  },
  school: {
    label: "School and settings",
    actions: {
      "class.create": "Created a class", "class.update": "Edited a class", "class.delete": "Deleted a class",
      "staff.create": "Added staff", "staff.update": "Edited staff", "school.update": "Changed school hours",
      "school.logo": "Changed the school logo", "school.create": "Created the school", "calendar.add": "Added holidays",
      "calendar.remove": "Removed a holiday", "alerts.update": "Changed alert settings", "retention.update": "Changed the retention period",
      "device.create": "Registered a kiosk", "device.revoke": "Revoked a kiosk", "sms.retry": "Retried an SMS", "alerts.test": "Sent a test alert", "demo.handled": "Marked a demo request", "order.status": "Updated a website order", "billing.website_prices": "Changed the website prices", "student.delete": "Deleted a student", "staff.delete": "Deleted a staff member", "user.update": "Changed a team login", "user.remove": "Removed a team login", "school.edit": "Edited a school", "school.delete": "Deleted a school", "lessons.settings": "Changed lesson settings", "subject.create": "Added a subject", "subject.delete": "Removed a subject", "assignment.create": "Added to the timetable", "assignment.delete": "Removed from the timetable", "report.share": "Shared a teacher report", "pickup.add": "Added a pickup person", "pickup.edit": "Edited a pickup person", "pickup.approve": "Allowed a pickup person", "pickup.revoke": "Stopped a pickup person", "pickup.card": "Linked a pickup card", "pickup.card_block": "Blocked a pickup card", "pickup.card_unblock": "Unblocked a pickup card", "pickup.delete": "Removed a pickup person", "pickup.code": "Created a pickup code", "pickup.code_cancel": "Cancelled a pickup code", "pickup.parent_add": "Parent added a pickup person", "pickup.parent_approve": "Parent approved a pickup person", "pickup.parent_code": "Parent created a pickup code", "emergency.start": "Started an emergency roll call", "emergency.end": "Ended an emergency roll call", "emergency.broadcast": "Messaged parents about an emergency", "emergency.pin": "Changed the emergency PIN", "pickup.qr": "Made a QR pickup pass", "portal.update": "Changed the school portal link", "portal.remove": "Disconnected the school portal",
      "report.export": "Exported a report",
    },
  },
  security: {
    label: "Logins and security",
    actions: {
      "user.create": "Created a login", "user.password_reset": "Reset a password", "user.email_change": "Changed a login email",
      "auth.mfa_enabled": "Turned on two-factor login", "auth.mfa_disabled": "Turned off two-factor login", "auth.mfa_verified": "Signed in with two-factor",
    },
  },
  billing: {
    label: "Billing",
    actions: {
      "billing.pricing": "Changed pricing", "billing.generate": "Issued invoices", "billing.platform_settings": "Changed business details",
      "billing.invoice_paid": "Marked an invoice paid", "billing.invoice_void": "Voided an invoice", "billing.invoice_issued": "Reopened an invoice",
    },
  },
};

const ALL: Record<string, string> = Object.assign({}, ...Object.values(AUDIT_GROUPS).map((g) => g.actions));

export function auditLabel(action: string): string {
  return ALL[action] ?? action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function actionsInGroup(group: string | undefined): string[] | null {
  return group && AUDIT_GROUPS[group] ? Object.keys(AUDIT_GROUPS[group].actions) : null;
}

/** A short, safe summary of the details object (no long blobs, no phone numbers). */
export function auditDetail(details: Record<string, unknown> | null): string {
  if (!details) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(details)) {
    if (v === null || v === undefined || typeof v === "object") continue;
    if (/phone/i.test(k)) continue;
    parts.push(`${k.replace(/_/g, " ")}: ${String(v).slice(0, 60)}`);
    if (parts.length === 4) break;
  }
  return parts.join(" · ");
}
