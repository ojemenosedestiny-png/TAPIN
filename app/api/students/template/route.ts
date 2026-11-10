import { getSchoolAdmin } from "@/lib/auth/session";
import { buildImportTemplate } from "@/lib/excel";

/** GET /api/students/template — the Excel template for bulk import. */
export async function GET() {
  if (!(await getSchoolAdmin())) return new Response("Sign in as a school admin.", { status: 401 });
  const buf = await buildImportTemplate();
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="tapin-students-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
