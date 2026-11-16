# Builds the TapIn Operations Manual PDF.  pip install reportlab;  python docs/operations-manual.py TapIn-Operations-Manual.pdf
import sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
                                PageBreak, KeepTogether, ListFlowable, ListItem, NextPageTemplate, CondPageBreak)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily

OUT = sys.argv[1]
F = "C:/Windows/Fonts/"
pdfmetrics.registerFont(TTFont("UI", F + "segoeui.ttf"))
pdfmetrics.registerFont(TTFont("UI-B", F + "segoeuib.ttf"))
pdfmetrics.registerFont(TTFont("UI-I", F + "segoeuii.ttf"))
pdfmetrics.registerFont(TTFont("UI-SB", F + "seguisb.ttf"))
registerFontFamily("UI", normal="UI", bold="UI-B", italic="UI-I", boldItalic="UI-B")

TEAL = colors.HexColor("#0f766e"); DEEP = colors.HexColor("#0b2f2c"); MINT = colors.HexColor("#e6f6f1")
GOLD = colors.HexColor("#f59e0b"); GOLD_BG = colors.HexColor("#fff7e6"); INK = colors.HexColor("#111827")
SOFT = colors.HexColor("#4b5563"); MUTED = colors.HexColor("#6b7280"); LINE = colors.HexColor("#e5e7eb")
ROW = colors.HexColor("#f7f9f9"); SLATE_BG = colors.HexColor("#f1f5f9"); RED = colors.HexColor("#b91c1c"); RED_BG = colors.HexColor("#fdecec")

base = dict(fontName="UI", fontSize=10, leading=14.6, textColor=INK)
S = {
    "p": ParagraphStyle("p", **base, spaceAfter=6),
    "lead": ParagraphStyle("lead", **{**base, "fontSize": 11.2, "leading": 16.5, "textColor": SOFT}, spaceAfter=10),
    "part": ParagraphStyle("part", fontName="UI-B", fontSize=11, leading=14, textColor=TEAL, spaceAfter=4),
    "h1": ParagraphStyle("h1", fontName="UI-B", fontSize=21, leading=26, textColor=DEEP, spaceBefore=0, spaceAfter=6, keepWithNext=1),
    "h2": ParagraphStyle("h2", fontName="UI-B", fontSize=13, leading=17, textColor=INK, spaceBefore=12, spaceAfter=5, keepWithNext=1),
    "h3": ParagraphStyle("h3", fontName="UI-SB", fontSize=10.6, leading=14, textColor=TEAL, spaceBefore=8, spaceAfter=3, keepWithNext=1),
    "cell": ParagraphStyle("cell", **{**base, "fontSize": 8.9, "leading": 12}),
    "cellb": ParagraphStyle("cellb", **{**base, "fontName": "UI-SB", "fontSize": 8.9, "leading": 12}),
    "head": ParagraphStyle("head", **{**base, "fontName": "UI-B", "fontSize": 8.9, "leading": 12, "textColor": colors.white}),
    "note": ParagraphStyle("note", **{**base, "fontSize": 9.4, "leading": 13.4}),
    "toc1": ParagraphStyle("toc1", fontName="UI-SB", fontSize=10.2, leading=15, textColor=INK, leftIndent=0),
    "toc0": ParagraphStyle("toc0", fontName="UI-B", fontSize=9.4, leading=18, textColor=TEAL, spaceBefore=6),
    "code": ParagraphStyle("code", fontName="Courier", fontSize=8.6, leading=11.5, textColor=INK, backColor=SLATE_BG, borderPadding=(4, 6, 4, 6), spaceBefore=3, spaceAfter=8),
}

story = []
chapter = [0]

class Doc(BaseDocTemplate):
    def afterFlowable(self, f):
        if isinstance(f, Paragraph):
            if f.style.name == "h1":
                self.notify("TOCEntry", (1, f.getPlainText(), self.page))
            elif f.style.name == "part":
                self.notify("TOCEntry", (0, f.getPlainText(), self.page))

def part(t):
    story.append(Paragraph(t, S["part"]))

def h1(t, lead=None, new_page=True):
    if new_page:
        story.append(PageBreak())
    chapter[0] += 1
    story.append(Paragraph(f"{chapter[0]}&nbsp;&nbsp;{t}", S["h1"]))
    rule = Table([[""]], colWidths=[170 * mm], rowHeights=[2])
    rule.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, 0), 2, TEAL)]))
    story.append(rule)
    story.append(Spacer(1, 8))
    if lead:
        story.append(Paragraph(lead, S["lead"]))

def h2(t): story.append(Paragraph(t, S["h2"]))
def h3(t): story.append(Paragraph(t, S["h3"]))
def p(t): story.append(Paragraph(t, S["p"]))
def code(t): story.append(Paragraph(t.replace(" ", "&nbsp;"), S["code"]))
def sp(h=6): story.append(Spacer(1, h))

def bullets(items):
    story.append(ListFlowable([ListItem(Paragraph(i, S["p"]), leftIndent=12) for i in items],
                              bulletType="bullet", start="•", leftIndent=12, bulletFontName="UI-B", bulletColor=TEAL, bulletFontSize=9))

def steps(items):
    story.append(ListFlowable([ListItem(Paragraph(i, S["p"]), leftIndent=17) for i in items],
                              bulletType="1", leftIndent=17, bulletFontName="UI-B", bulletColor=TEAL, bulletFontSize=9.5))

def table(rows, widths, bold_first=True):
    data = []
    for r, row in enumerate(rows):
        data.append([Paragraph(c, S["head"] if r == 0 else (S["cellb"] if (ci == 0 and bold_first) else S["cell"])) for ci, c in enumerate(row)])
    t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1)
    st = [("VALIGN", (0, 0), (-1, -1), "TOP"), ("BACKGROUND", (0, 0), (-1, 0), DEEP),
          ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE),
          ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
          ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7)]
    for i in range(1, len(rows)):
        if i % 2 == 0:
            st.append(("BACKGROUND", (0, i), (-1, i), ROW))
    t.setStyle(TableStyle(st))
    story.append(t)
    sp(10)

def callout(text, kind="tip"):
    title, bg, bar = {"tip": ("Tip", MINT, TEAL), "important": ("Important", GOLD_BG, GOLD),
                      "status": ("Status", SLATE_BG, MUTED), "warning": ("Safety", RED_BG, RED)}[kind]
    box = Table([[Paragraph(f"<b>{title}.</b>&nbsp; {text}", S["note"])]], colWidths=[170 * mm])
    box.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), bg), ("LINEBEFORE", (0, 0), (0, -1), 3, bar),
                             ("LEFTPADDING", (0, 0), (-1, -1), 11), ("RIGHTPADDING", (0, 0), (-1, -1), 11),
                             ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 9)]))
    story.append(KeepTogether([box, Spacer(1, 9)]))

# =========================================================================================== cover
story.append(Spacer(1, 62 * mm))
story.append(Paragraph("TapIn", ParagraphStyle("c0", fontName="UI-B", fontSize=46, leading=52, textColor=colors.white)))
sp(4)
story.append(Paragraph("Operations Manual", ParagraphStyle("c1", fontName="UI-SB", fontSize=24, leading=30, textColor=colors.HexColor("#ccfbf1"))))
sp(14)
story.append(Paragraph("School attendance and child safety, from the gate to the parent's phone.<br/>Setup, daily operation, parent handover, staff security, offices and companies, pricing and payments, hosting, security and recovery.",
                       ParagraphStyle("c2", fontName="UI", fontSize=11.5, leading=17, textColor=colors.HexColor("#d2ebe6"))))
story.append(Spacer(1, 92 * mm))
story.append(Paragraph("Version 2.0 &nbsp;·&nbsp; 16 November 2026 &nbsp;·&nbsp; www.tapinsafe.app",
                       ParagraphStyle("c3", fontName="UI-SB", fontSize=9.5, leading=13, textColor=colors.HexColor("#d2ebe6"))))
story.append(Paragraph("For the TapIn owner and school administrators. Confidential: do not share keys or passwords from this manual.",
                       ParagraphStyle("c4", fontName="UI", fontSize=8.5, leading=12, textColor=colors.HexColor("#9cc7bf"))))
story.append(NextPageTemplate("body"))
story.append(PageBreak())

# =========================================================================================== contents
story.append(Paragraph("Contents", ParagraphStyle("ct", fontName="UI-B", fontSize=21, leading=26, textColor=DEEP, spaceAfter=14)))
toc = TableOfContents()
toc.levelStyles = [S["toc0"], S["toc1"]]
toc.dotsMinLevel = 1
story.append(toc)

# =========================================================================================== PART A
story.append(PageBreak())
part("Part A · Overview")
h1("About TapIn", "TapIn records who is at school, tells parents straight away, and makes sure every child goes home with the right person.", new_page=False)
p("Every student, teacher and (optionally) parent has a smart card. At each gate, a phone or tablet running the TapIn <b>kiosk</b> reads the card. One tap records the time, shows the person's photo for the gate staff to check, greets them by name, and sends the parent a WhatsApp or SMS message within seconds.")
table([
    ["Area", "What TapIn does"],
    ["Attendance", "Sign-in and sign-out at the gate, late arrivals, absences after the cutoff time, class registers, reports and exports."],
    ["Parent handover", "At drop-off the parent taps after the child; at pickup the parent taps first, then the child, and staff confirm the faces. Bus children tap alone."],
    ["Safe pickup", "Approved collectors with photos and cards, one-day pickup codes and QR passes, a red warning for anyone not linked to the child."],
    ["Parent messages", "Arrival, departure, late, absence, drop-off, pickup, bus and late-pickup messages by WhatsApp or SMS, in the school's name."],
    ["Teachers and staff", "Staff attendance, lesson start and end at the kiosk, monthly teacher reports for the school's director."],
    ["Staff security", "Optional card + 4-digit PIN, a kiosk photo at every staff tap, late and early alerts, and set check-in hours."],
    ["Offices and companies", "The same kiosk for any workplace: staff only, no students or parents (chapter 9)."],
    ["Emergency", "Roll call (Premium): every kiosk becomes an assembly point; the dashboard shows who is still missing."],
    ["Parents' tools", "Parent portal, WhatsApp assistant, pickup codes, approving pickup people. TapIn is free for parents: the school pays."],
    ["Business", "Editable prices, quotes as PDFs, subscriptions with renewal reminders, card and kiosk orders, online invoice payment with OPay."],
    ["Reliability", "Works through power cuts and network drops; taps are saved on the kiosk and sent later with their real time."],
    ["Integration", "Each sign-in can be sent to the school's own portal register."],
], [36, 134])
callout("Every record belongs to one school. A school can only ever see its own data: this is enforced by the database itself, not only by the screens.", "tip")

h1("Roles and access", "Who uses TapIn, how they sign in, and what each one can do.")
table([
    ["Role", "Signs in with", "Can do"],
    ["Super admin (TapIn owner)", "Email, password and two-factor code (required)", "Create schools and organisations and their admins; prices, quotes, subscriptions, invoices and card/kiosk orders; demo requests. No routine access to student records."],
    ["School admin", "Email and password (two-factor optional)", "Everything for their own school: students, staff, classes, cards, kiosks, alerts, lessons, pickup, emergency, reports, settings, ordering cards and kiosks, paying invoices."],
    ["Organisation admin", "Email and password (two-factor optional)", "The same for an office or company, without the student, class, lesson and pickup pages. Organisations have admin logins only."],
    ["Teacher", "Email and password, created by the school admin", "Today's attendance, students, reports, their own monthly report, ticking students safe in a roll call."],
    ["Parent", "Mobile number and a one-time code", "See their children's attendance, choose SMS or WhatsApp, manage pickup people, create pickup codes, use the WhatsApp assistant."],
    ["Kiosk (a device)", "A device token from Devices", "Read cards, codes and QR passes at the gate. Nothing else. Revoked in one click if lost."],
    ["Director", "No sign-in: a phone number", "Receives lesson summaries and the monthly teacher report link."],
], [36, 46, 88])

h1("A school day with TapIn", "What happens, and when, on a normal school day.")
table([
    ["Time", "At the gate", "What TapIn does"],
    ["6:30 am", "Gate staff open the kiosk and press Start scanning.", "The kiosk shows the clock and \"Tap your ID card\"."],
    ["7:00–8:00", "Children tap in. With handover on, a parent taps after their child.", "Records the time, greets each child, tells the parent; flags children whose parent did not tap."],
    ["After the late time", "Late children tap in.", "Marked late; parents get the late message; the teacher sees it."],
    ["Absence cutoff", "—", "Parents of children not in school get an absence alert (not at weekends or on holidays)."],
    ["During the day", "Teachers tap to start and end lessons.", "Lesson times and flags go to the Lessons page; directors can get summaries."],
    ["Closing time", "Parents tap, then each child taps; staff release. Bus children tap alone.", "Signs children out, tells parents who collected them; refuses anyone not linked."],
    ["Closing + 30 min", "—", "Parents of children still in school get a late-pickup message (once a day)."],
    ["Overnight", "—", "Backups, data clean-up, monthly reports when due."],
], [26, 66, 78])

# =========================================================================================== PART B
story.append(PageBreak())
part("Part B · Setting up")
h1("Bringing a new school on board", "From signing the school to the first morning at the gate.", new_page=False)
h2("Super admin steps")
steps([
    "Send a quote: <b>Quotes</b> → choose the school (or type a new one), the items and plan → <b>Save and open quote</b> → <b>PDF / Print</b> (chapter 18).",
    "Go to <b>Schools</b> → <b>New school or organisation</b>: choose the <b>Type</b> (School, or Organisation for an office), the name and hours, then create its admin login with <b>New user</b>.",
    "Put it on a plan: <b>Subscriptions</b> → <b>Set plan</b>, with the agreed monthly price and renewal date. The plan also sets the feature level (Premium adds the emergency roll call).",
])
h2("The school admin's checklist")
p("After signing in, the school admin sees <b>Getting started</b>. Each step ticks itself off when done.")
table([
    ["Step", "Where", "Notes"],
    ["Check school hours", "Settings → School day", "Resumption (late after), absence cutoff, closing time, time zone."],
    ["Add this term's holidays", "Settings → School calendar", "No absence alerts on holidays; reports leave them out."],
    ["Create classes", "Classes", "Only empty classes can be deleted."],
    ["Add class teachers", "Staff, and Settings → Team", "Teachers see only their own class."],
    ["Import students and parents", "Students → Import from Excel", "Matched by admission number, so a file can be re-imported to update."],
    ["Record parental consent", "Each student's profile", "Required before a photo can be added. A printable form is in Help."],
    ["Add photos", "Profiles, or Students → Bulk photos", "Name bulk photos by admission number, e.g. STU0012.jpg."],
    ["Enrol ID cards", "Enrol cards", "Pick a class and tap each child's card in turn."],
    ["Test each card", "The kiosk", "Each card must show the right face and name."],
    ["Register the gate kiosk", "Devices → Register kiosk", "Gives the one-time device token (chapter 5)."],
    ["Send a test alert", "Alerts → Send a test alert", "Checks that SMS or WhatsApp reaches a phone."],
], [42, 46, 82])

h1("Setting up the gate kiosk")
h2("What you need")
bullets([
    "An <b>Android phone or tablet with NFC</b>, running Chrome. Or any computer with a <b>USB card reader</b> (it types the card number).",
    "A stand at the gate, power, and Wi-Fi or mobile data. The kiosk keeps working through outages (see below).",
    "For QR pickup passes: a camera. Android uses the built-in reader; Windows laptops use TapIn's own reader.",
])
h2("Connect a kiosk")
steps([
    "In the dashboard: <b>Devices → Register kiosk</b>. Name it (e.g. Main gate) and copy the <b>device token</b>. It is shown once.",
    "On the gate device, open <b>https://www.tapinsafe.app/kiosk</b> and paste the token.",
    "Press <b>Start scanning</b> once each morning. Press <b>Test sound</b> to check the volume.",
])
h2("Offline and power cuts")
p("If the network drops, the kiosk keeps reading cards, saves each tap with its real time, and sends them when the connection returns; parent messages follow. Pickup, lessons and starting a roll call need the kiosk to be online, and the screen says so.")
callout("Lost or stolen kiosk: <b>Devices → Revoke</b>. Its token stops working at once and its taps are refused. Register a new kiosk for the replacement.", "important")

h1("Cards, photos and consent")
table([
    ["Task", "How"],
    ["Link a card to a student or staff member", "Open their profile → Assign card → tap the card (or type its number). A card already in use is refused."],
    ["Enrol a whole class", "Enrol cards → choose the class → tap each card as the name comes up."],
    ["Print ID cards", "Cards → Print. Bank-card size; print at 100% (Actual size)."],
    ["Lost card", "Cards → Block, then link a new card to the same person."],
    ["Photo", "Record parental consent first, then add the photo on the profile, or use Bulk photos."],
    ["Parent card", "Safe pickup → Add a parent → Card (chapter 7)."],
], [56, 114])

h1("Setting up parent handover", "Parents tap their own card at drop-off and pickup. Switched off by default: nothing changes until the school turns it on.")
steps([
    "<b>Settings → Parent handover</b>: tick <b>Parents tap their card at the gate</b>, set the <b>late pickup alert</b> minutes (default 30), and Save.",
    "For each student, open the profile and set <b>Going home</b>: <b>Parent pickup</b> or <b>School bus</b>. Bus children always tap on their own.",
    "Give parents cards: <b>Safe pickup → Add a parent</b>, choose the parent (the list shows their phone and children), then use <b>Card</b> on their row and add their photo.",
    "Other collectors (aunt, driver): <b>Safe pickup → Add pickup person</b>, choose the children, add a photo and a card.",
])
callout("A parent is linked to all their own children automatically, including children added later. Other collectors are linked only to the children you choose.", "tip")

h1("Staff check-in security", "Optional checks when staff tap in and out. Each switch works on its own; all are off until the school turns them on.")
p("Turn them on in <b>Settings → Staff check-in security</b>, then Save. Kiosks use the new rules from the next tap.")
table([
    ["Check", "What happens at the kiosk", "Notes"],
    ["Card + 4-digit PIN", "After tapping, a keypad shows the person's name and photo; they type their own PIN.", "5 wrong PINs lock that person for 15 minutes and tell the admin. Staff with no PIN yet still check in, marked No PIN."],
    ["Photo at every tap", "The front camera takes a small photo at each check-in and check-out.", "Allow camera access once on the kiosk. Photos are private to the school and deleted after 30 days."],
    ["Alerts", "No change at the gate.", "Notices for late arrival, leaving before closing, wrong-PIN lockouts, and each morning a list of staff who did not check out."],
    ["Allowed hours", "Taps outside the hours show red: Not checked in.", "Leave both times empty for no limit. Staff can only ever check in on the school's registered kiosks."],
], [30, 66, 74])
h2("Setting a PIN")
steps([
    "<b>Staff</b> → open the person → <b>Check-in security</b> → <b>Set PIN</b>. Type 4 digits twice. Easy PINs (1234, 1111) are refused.",
    "Tell the person privately. Nobody can read a PIN back, not even the admin: to change it, set a new one.",
    "After a lockout, <b>Unlock</b> lets them try again straight away. <b>Remove PIN</b> lets them check in without one (marked No PIN).",
])
p("The same page shows the last 7 days of check-ins with the kiosk photo and a green <b>PIN</b> tick or an amber <b>No PIN</b> mark. An offline kiosk can't ask for a PIN: its taps are saved, sent later and marked No PIN.")

h1("Offices and companies (organisations)", "TapIn for any workplace: staff only, with the same kiosk, cards and security.")
p("An <b>organisation</b> is created like a school, with <b>Type: Organisation</b>. Its admin sees only what an office needs.")
table([
    ["Part", "For an organisation"],
    ["Menu", "Today, Getting started, Staff, Emergency, Cards, Devices, Order cards and kiosks, Alerts, Reports, Settings, Activity log, Help."],
    ["Hidden", "Students, Classes, Lessons, Safe pickup, class card enrolment. Typing one of those addresses returns to Today."],
    ["Today", "Staff in now, late, not in yet, anyone refused at the kiosk, and the staff list with in and out times."],
    ["Settings", "Working day, calendar, staff check-in security, team (admins only). No parent handover, school portal or student retention."],
    ["Reports and alerts", "Staff reports and Excel export; notices only (no parent SMS or WhatsApp)."],
    ["Kiosk", "No Pickup code or Scan QR buttons."],
    ["Plans", "Office plans are sized by staff (e.g. 1–25 staff) and shown on the website's pricing page."],
], [34, 136])

# =========================================================================================== PART C
story.append(PageBreak())
part("Part C · Daily operation")
h1("At the gate: every screen explained", "What each kiosk screen means and what the gate staff should do.", new_page=False)
table([
    ["Screen", "When", "Gate staff"],
    ["White card, green ring, Signed in", "A child or teacher arrives on time.", "Check the face matches the photo."],
    ["Amber ring, Signed in · Late", "Arrival after the late time.", "Nothing; the school and parents are told."],
    ["\"Parent: tap your card now\"", "Handover is on and a parent-pickup child signed in.", "Ask the parent to tap within 2 minutes."],
    ["Dropped off by …", "The parent tapped after their children.", "Nothing; that parent gets a message."],
    ["Blue ring, Signed out", "A child (bus, or handover off) leaves.", "Check the face."],
    ["Amber, Wait for your parent", "A parent-pickup child tapped out alone.", "The child waits; the parent taps first."],
    ["Safe pickup screen", "A parent's card, QR pass or code opened a pickup.", "Each child taps; check faces; press Release."],
    ["Red, Do not release", "A child tapped who is not linked to that collector.", "Do not let the child go. The office is told."],
    ["Red, Not authorised", "A stopped person or blocked card.", "Do not release any child; call the office."],
    ["Red, Card not recognised", "An unknown or blocked card.", "Send the holder to the office."],
    ["Teacher menu", "A teacher's later tap.", "Teacher chooses Start lesson or Sign out."],
    ["Green, Safe", "During an emergency roll call.", "Each person taps at the assembly point."],
    ["Staff check-in keypad", "PIN or photo is on for staff.", "The staff member types their own PIN and looks at the camera."],
    ["Red, Not checked in", "Wrong PINs (locked) or outside staff hours.", "Ask the admin; a lockout ends after 15 minutes or by Unlock."],
], [46, 58, 66])

h1("Drop-off and pickup, step by step")
h2("Drop-off (handover on)")
steps([
    "The child taps their card. The kiosk greets them and shows <b>Parent: tap your card now</b>. The child is signed in at once.",
    "Within <b>2 minutes</b>, the parent taps their card. All of their waiting children (siblings too) are matched; the screen shows <b>Dropped off by …</b>.",
    "That parent receives: <i>\"[School]: Kemi Okafor has checked in at 7:42 AM.\"</i>",
    "If no parent taps in time, the child stays signed in, the usual arrival message is sent, and the dashboard shows a <b>flag</b>.",
])
h2("Pickup")
steps([
    "The parent taps their card (or shows a QR pass, or types a one-day code). The kiosk shows their photo and their children.",
    "Each child taps their own card. Their row turns green: <b>Ready</b>.",
    "Staff compare the faces and press <b>Release</b>. The children are signed out and the parents are told who collected them.",
    "If a child taps who is not linked to that person: red <b>Do not release</b>, the child is not signed out, and the office sees a notice.",
])
callout("The two taps prove the card holder and the child are linked; the staff check of the faces catches a borrowed or stolen card. Never release a child from a red screen.", "warning")
h2("Bus children")
p("Bus children tap alone, morning and afternoon. Parents receive <i>\"… has arrived at school at 7:35 AM.\"</i> and <i>\"… has left school on the bus at 2:10 PM.\"</i>")

h1("Pickup codes and QR passes")
table([
    ["Option", "Who creates it", "Rules"],
    ["One-day code", "A parent (parent portal; WhatsApp coming in step 3) or the school (Safe pickup → Code)", "6 digits, today only, one use, only for the chosen children. Entered on the kiosk, then each child taps."],
    ["QR pass", "Safe pickup → QR pass, or the parent portal", "For a regular collector; works like their card."],
    ["Pickup card", "Safe pickup → Card", "For parents and regular collectors."],
], [30, 62, 78])
callout("Five wrong codes in a row lock code entry on that kiosk for <b>15 minutes</b> and tell the office. A correct code resets the count.", "important")

h1("Emergency roll call (Premium)")
steps([
    "Start it from <b>Emergency</b> in the dashboard, or on a kiosk with the school's emergency PIN.",
    "Every kiosk becomes an assembly point; people tap as they arrive and are marked safe.",
    "The dashboard shows live counts by class: on the roll, safe, still missing. Teachers tick the rest on their phones.",
    "Send a broadcast to parents if needed. End the roll call; a printable incident report is ready.",
])

h1("Teachers and lessons")
bullets([
    "A teacher's first tap signs them in. Later taps open the <b>lesson menu</b>: choose class and subject to start, tap again to end.",
    "<b>Lessons</b> shows who is teaching now, the week, and flags (too short, too long, not ended).",
    "<b>Lessons → Monthly</b> shows each teacher's attendance, punctuality and teaching time; it can be shared with the director by link.",
    "Turn it on, set rules, subjects and timetable in <b>Lessons → Setup</b>.",
])

h1("The dashboard, page by page")
table([
    ["Page", "What it is for"],
    ["Today", "Live gate: who is in, late or absent, arrivals by time, class registers, and notices that need a look."],
    ["Students", "Profiles, parents, photos, cards, consent, Going home (parent pickup or bus), import and bulk photos."],
    ["Staff / Classes", "Staff who tap in, their PIN and check-in photos; classes and their teachers."],
    ["Lessons", "Lesson check, weekly view, monthly teacher reports."],
    ["Safe pickup", "Parents and pickup people, cards, QR passes, one-day codes, today's pickups and refusals."],
    ["Emergency", "Roll call, emergency PIN, incident reports (Premium)."],
    ["Cards / Enrol cards", "Every card; block lost cards; print cards; enrol a class."],
    ["Devices", "Kiosks: register, see online/offline, revoke, unlock code entry."],
    ["Order cards and kiosks", "Order more cards, wristbands or kiosks at TapIn's prices; an invoice is made at once; follow each order to delivery."],
    ["Alerts", "Message settings and wording, quiet hours, monthly allowance, test alert, message log, WhatsApp assistant conversations and a ready message to share the number with parents."],
    ["Reports", "Attendance by date range and class; export to Excel."],
    ["Settings", "School day, calendar, parent handover, staff check-in security, school portal link, data retention, your plan and renewal date, invoices, team logins."],
    ["Activity log", "Sensitive actions: who did what, when."],
], [36, 134])

h1("Parents")
table([
    ["Feature", "How it works"],
    ["Messages", "By WhatsApp or SMS (the parent chooses), sent under the school's name. Quiet hours hold non-urgent messages until morning."],
    ["Parent portal", "www.tapinsafe.app/parent: sign in with the phone number the school has and a one-time code. Attendance for the last 30 days, message channel, pickup people, codes, QR passes."],
    ["WhatsApp assistant", "Parents message TapIn's WhatsApp number in plain words (English or Pidgin): today's attendance, absences this term, pickup, who can collect, a one-day pickup code, a sick day, or a request to collect early. Only numbers on a child's record get answers."],
    ["Finding the number", "Every alert comes from it, so parents just reply. It is also on the parent page and the printed consent form with a Chat on WhatsApp button and a QR code. Set it in Billing → Website details."],
    ["Cost", "Free for parents. The school pays TapIn; the WhatsApp assistant tells parents to ask the school office about school fees."],
    ["Privacy", "A parent only ever sees their own children."],
], [34, 136])

# =========================================================================================== PART D
story.append(PageBreak())
part("Part D · Messaging")
h1("SMS and WhatsApp", "How messages are sent, what each one needs, and what they cost.", new_page=False)
p("Every message is saved first, then sent within two minutes. Failed messages retry three times, two minutes apart. Each message is sent once only, and arrival or departure news older than six hours is dropped rather than sent late.")
table([
    ["Channel", "Provider", "Needs"],
    ["SMS", "Termii", "Termii API key and an <b>approved sender ID</b> (e.g. TAPIN). Until it is approved, SMS is not sent."],
    ["WhatsApp alerts", "Meta WhatsApp Cloud API", "A real WhatsApp business number and one <b>approved template</b> per message type."],
    ["WhatsApp replies", "Meta WhatsApp Cloud API", "No template: free replies within 24 hours of the parent's message."],
], [32, 40, 98])
h2("WhatsApp templates")
p("Create each template in WhatsApp Manager (category <b>Utility</b>, language English), then add a setting in Vercel: <b>WHATSAPP_TEMPLATE_&lt;TYPE&gt;</b> = <i>template_name:number_of_blanks</i>, e.g. <font face='Courier'>tapin_arrival:3</font>. Blanks: {{1}} child, {{2}} school, {{3}} time or date, {{4}} reason or collector. Meta needs the blanks in order, starting with {{1}}.")
table([
    ["Setting", "Sent when", "Suggested body"],
    ["…_ARRIVAL", "A child signs in", "{{1}} arrived at {{2}} at {{3}}."],
    ["…_DEPARTURE", "A child signs out", "{{1}} left {{2}} at {{3}}."],
    ["…_LATE", "Late arrival", "{{1}} arrived late at {{2}} at {{3}}."],
    ["…_ABSENCE", "Not in by the cutoff", "{{1}} has not arrived at {{2}} today, {{3}}. Please contact the school."],
    ["…_EARLY", "Early release", "{{1}} left {{2}} early at {{3}}. Reason: {{4}}."],
    ["…_DROPOFF", "Parent handover at drop-off", "{{1}} has checked in at {{2}} at {{3}}."],
    ["…_PICKUP", "Collected at pickup", "{{1}} was collected from {{2}} at {{3}} by {{4}}."],
    ["…_BUS", "Bus child leaves", "{{1}} has left {{2}} on the bus at {{3}}."],
    ["…_LATE_PICKUP", "Still in school after closing", "{{1}} is still at {{2}} at {{3}}. Please collect them."],
    ["…_OTP", "Parent sign-in code", "Category <b>Authentication</b> with a Copy code button; Meta writes the text. Setting: just the template name."],
], [32, 44, 94])
callout("Meta charges per alert sent with a template; replies within 24 hours are free up to Meta's monthly allowance. Termii charges per SMS. Each school's <b>monthly allowance</b> caps what it sends. Meta's test number only reaches its allowed list: use a real Nigerian number and complete business verification before going live.", "tip")

# =========================================================================================== PART E
story.append(PageBreak())
part("Part E · Running TapIn the business")
h1("Pricing, quotes and subscriptions", "The super admin's side of TapIn. No price is written in the code: everything is set on these pages.", new_page=False)
table([
    ["Page", "What you do"],
    ["Schools", "Create schools and organisations and their admins, see demo requests (tagged Office for companies), and which schools are overdue."],
    ["Pricing", "Setup items (kiosk, cards, wristbands…) and monthly plans with their size range, for schools (students) or offices (staff); free months for paying yearly; every change in Price history."],
    ["Quotes", "Build a quote with live totals, save it (numbered Q-2026-0001) and print it as a branded PDF."],
    ["Subscriptions", "Each school's plan, agreed monthly price, billing and renewal date. Renew, Suspend, Move to current price. Overdue schools first."],
    ["Billing", "Invoices, card and kiosk orders (Mark paid, Mark delivered), website orders, website details and your bank details."],
], [32, 138])
h2("How prices behave")
bullets([
    "Items and plans start at ₦0 and switched off. Tick <b>Active</b> and set a price before they appear on quotes, the website and the order page.",
    "A school keeps its <b>agreed price</b> when you change a plan's price. Subscriptions shows \"Plan now ₦…\" with <b>Move to current price</b>.",
    "Yearly billing: 12 months for the price of 12 minus the free months you set.",
    "Schools are reminded in TapIn 7 days before renewal (no price shown). School admins see only their plan name, renewal date and status.",
])
h2("Card and kiosk orders")
steps([
    "The school admin opens <b>Order cards and kiosks</b> (also from Cards and Devices), enters quantities and places the order. An invoice is made at once with your bank details.",
    "You see it in <b>Billing → Card and kiosk orders</b> and on the Schools page. When the money arrives: <b>Mark paid</b> (the invoice is marked paid too).",
    "Deliver, then <b>Mark delivered</b>. The school sees each step. A school can cancel before paying.",
])
h2("Paying invoices online with OPay")
p("When OPay is set up, every unpaid invoice shows <b>Pay online with OPay</b> to the school admin: card, bank transfer or USSD on OPay's page. When they come back, TapIn asks OPay directly whether it was paid and for how much; only then are the invoice (and its order) marked paid. A short or failed payment changes nothing.")
steps([
    "OPay Business → Developer: copy the <b>Merchant ID</b>, <b>Public key</b> and <b>Secret key</b>.",
    "Vercel → Environment Variables: <b>OPAY_MERCHANT_ID</b>, <b>OPAY_PUBLIC_KEY</b>, <b>OPAY_SECRET_KEY</b>, and <b>OPAY_ENV</b> = sandbox (test) or live. Redeploy.",
    "Test in sandbox with OPay's test card, then switch OPAY_ENV to live.",
])
callout("Without the OPay keys nothing changes: invoices are paid by bank transfer and marked paid by you, as before.", "tip")

h1("Connecting a school's own portal")
p("Each sign-in at a TapIn kiosk can mark the child present or late in the school's own portal register.")
steps([
    "In the school portal, create a kiosk key (for TapIn) and copy it.",
    "In TapIn: <b>Settings → School portal</b>. Enter the portal's tap address and the key, choose how to match children (card number or admission number), and <b>Connect portal</b>.",
    "Press <b>Test connection</b>. The latest sign-ins sent appear on the same page; a card the portal does not know shows <i>Card not linked in portal</i>.",
])
p("If the portal is down, TapIn keeps each sign-in and retries for up to six days. The key is stored on the server only and is never shown again.")

# =========================================================================================== PART F
story.append(PageBreak())
part("Part F · Technical operations")
h1("Website address and hosting", "TapIn runs on Vercel (website and kiosk) and Supabase (database, logins, files, scheduled jobs). The domain is managed in Cloudflare.", new_page=False)
h2("Domain: Cloudflare and Vercel")
steps([
    "<b>Vercel → Project → Settings → Domains</b>: add <font face='Courier'>tapinsafe.app</font> and <font face='Courier'>www.tapinsafe.app</font>. The bare domain redirects to www.",
    "<b>Cloudflare → DNS → Records</b>: an <b>A</b> record for <font face='Courier'>@</font> and a <b>CNAME</b> for <font face='Courier'>www</font>, with the exact values Vercel shows.",
    "Set both records to <b>DNS only</b> (grey cloud). The orange proxy causes redirect and certificate problems.",
    "Wait until both domains show <b>Valid Configuration</b> in Vercel; the HTTPS certificate is issued automatically.",
])
h2("After changing the address")
table([
    ["Where", "Change"],
    ["Supabase → Authentication → URL Configuration", "Site URL: https://www.tapinsafe.app. Redirect URLs: add https://www.tapinsafe.app/**"],
    ["Supabase → Project Settings → Vault", "tapin_app_url: https://www.tapinsafe.app (used by the scheduled jobs)"],
    ["Meta → WhatsApp → Configuration → Webhook", "Callback URL: https://www.tapinsafe.app/api/whatsapp/inbound?key=… (same key)"],
    ["Flutterwave → Settings → Webhooks", "https://www.tapinsafe.app/api/flutterwave/webhook (website orders)"],
    ["OPay", "Nothing to set: TapIn sends its callback address (www.tapinsafe.app/api/opay/callback) with each payment."],
    ["Meta → App settings → Basic", "Privacy Policy URL: https://www.tapinsafe.app/privacy"],
    ["Each kiosk", "Open https://www.tapinsafe.app/kiosk and connect it with a new device token."],
], [62, 108])
h2("Deploying changes")
p("Every push to the <b>main</b> branch on GitHub deploys automatically to Vercel in about two minutes. Database changes are applied separately with:")
code("npx supabase db push --db-url <database URL from .env.local> --yes")

h1("Settings reference")
p("Settings live in <b>Vercel → Settings → Environment Variables</b> (and in <font face='Courier'>.env.local</font> on the developer's computer). After any change, <b>Redeploy</b>. Never paste these values into chats or documents.")
table([
    ["Setting", "Purpose", "Where it comes from"],
    ["NEXT_PUBLIC_SUPABASE_URL, …_ANON_KEY", "Connects the site to the database", "Supabase → Project Settings → API"],
    ["SUPABASE_SERVICE_ROLE_KEY", "Server access to the database", "Supabase → Project Settings → API (secret)"],
    ["CRON_SECRET", "Protects the scheduled jobs", "Made by you; also in the Supabase vault"],
    ["TERMII_API_KEY, TERMII_SENDER_ID", "SMS", "Termii dashboard"],
    ["WHATSAPP_ACCESS_TOKEN", "Sending WhatsApp", "Meta → WhatsApp → API Setup (permanent token)"],
    ["WHATSAPP_PHONE_NUMBER_ID", "Which WhatsApp number sends", "Meta → WhatsApp → API Setup"],
    ["WHATSAPP_APP_SECRET", "Checks Meta's webhook signatures", "Meta → App settings → Basic"],
    ["WHATSAPP_INBOUND_SECRET", "Protects the WhatsApp webhook", "Made by you (16+ characters); also the verify token"],
    ["WHATSAPP_TEMPLATE_*", "Template per message type", "The SMS and WhatsApp chapter"],
    ["SEND_SMS_HOOK_SECRET", "Parent sign-in codes by SMS", "Supabase → Authentication → Hooks"],
    ["FLW_SECRET_KEY, FLW_SECRET_HASH", "Website order payments", "Flutterwave dashboard"],
    ["OPAY_MERCHANT_ID, OPAY_PUBLIC_KEY, OPAY_SECRET_KEY, OPAY_ENV", "Schools paying invoices online", "OPay Business → Developer; OPAY_ENV = sandbox or live"],
    ["ELEVENLABS_API_KEY, …_VOICE_ID", "The natural kiosk voice", "ElevenLabs (optional)"],
], [56, 52, 62])

h1("Automatic jobs")
p("These run on their own in Supabase. Times are Lagos time.")
table([
    ["Schedule", "Job"],
    ["Every 2 minutes", "Send queued messages; close expired handover windows (flag missing parents); late-pickup alerts; retry sends to school portals."],
    ["Every 15 minutes", "Absence alerts after the cutoff; offline kiosk alerts; daily summaries; close forgotten lessons and send director summaries."],
    ["Daily, 8:00 am", "Monthly teacher reports on the right day of the month; renewal reminders 7 days ahead; staff who did not check out yesterday."],
    ["Mondays, 7:00 am", "Weekly attendance watch: students whose attendance is slipping."],
    ["Nightly, 2:00–4:45 am", "Backup of the whole database; delete leavers' data after the school's retention period; delete staff check-in photos older than 30 days; clean up old rate limits, WhatsApp logs and portal deliveries."],
], [38, 132])

h1("Security and privacy")
bullets([
    "<b>School separation</b>: every table is locked to its own school by the database (row-level security).",
    "<b>Two-factor login</b>: required for the super admin, available to everyone; the rule covers every table.",
    "<b>Kiosks</b> use device tokens; a revoked device is refused at once.",
    "<b>Codes, QR passes, report links, the emergency PIN and staff PINs</b> are stored only as scrambled fingerprints; staff PINs are readable by the server alone.",
    "<b>Staff check-in photos</b> are private to the school and deleted after 30 days.",
    "<b>Online payments</b>: an invoice is marked paid only after TapIn asks OPay itself and the amount matches; a forged return or callback can't mark anything paid.",
    "<b>Pricing</b> is visible to the super admin only; school admins see their plan name and renewal date.",
    "<b>Limits</b> stop guessing: pickup codes and staff PINs lock after five wrong tries; sign-ins are rate-limited.",
    "<b>Activity log</b> records sensitive actions. <b>Retention</b> deletes leavers' data after the school's chosen period.",
    "<b>Consent</b> for photos and messages is recorded per student (Nigeria Data Protection Act 2023).",
])

h1("Backups and recovery")
table([
    ["Situation", "What to do"],
    ["A new version broke the site", "Vercel → Deployments → the last good one → Promote to Production (instant rollback)."],
    ["Go back to known-good code", "Git tag <font face='Courier'>recovery-2026-11-12</font>; see docs/RECOVERY.md."],
    ["Data deleted or damaged", "Stop. Download last night's backup (kept 14 nights) and restore into a new, empty Supabase project with scripts/backup.mjs. Everyone resets their password."],
    ["Kiosk lost or stolen", "Devices → Revoke."],
    ["A key or password leaked", "Change it at its source, update Vercel, Redeploy (full list in docs/RECOVERY.md)."],
], [44, 126])
p("Monthly: download the latest backup to an external drive, and tag a new safe point in Git.")
code("node --env-file=.env.local scripts/backup.mjs list")
code("node --env-file=.env.local scripts/backup.mjs download 2026-11-15 C:\\TapIn-backups\\2026-11-15")

h1("Troubleshooting")
table([
    ["Problem", "Likely cause", "Fix"],
    ["Kiosk: Card not recognised", "Card not linked, or blocked", "Link it on the profile, or unblock it in Cards."],
    ["Kiosk: offline banner", "No internet", "Taps are saved; they send when the network returns. Check Wi-Fi or data."],
    ["Kiosk asks for a token", "New address or cleared browser", "Devices → Register kiosk; paste the new token."],
    ["Child shows Wait for your parent", "Handover on; parent-pickup child alone", "Parent taps first, then the child. Bus children: set Going home to School bus."],
    ["Pickup: Do not release", "That child is not linked to the collector", "Do not release. Check Safe pickup links, or use a one-day code."],
    ["Code entry locked", "Five wrong codes", "Wait 15 minutes, or Devices → Unlock; check the code with the parent."],
    ["Staff: Not checked in", "Wrong PINs, or outside staff hours", "Staff page → Unlock, or check Settings → Staff check-in security."],
    ["Staff keypad but no PIN", "No PIN set for that person", "Staff page → Set PIN; until then they pass, marked No PIN."],
    ["Invoice still unpaid after paying", "OPay hasn't confirmed yet", "Refresh the invoice in a minute; check OPay's dashboard; mark paid by hand if needed."],
    ["Parents get no messages", "SMS sender not approved, or no WhatsApp template", "Alerts → message log shows the reason. Approve the sender ID or add the template."],
    ["WhatsApp: not in allowed list", "Meta test number", "Add the number in Meta's To list, or move to a real number."],
    ["Password reset link opens the old address", "Supabase Site URL", "Chapter 20: set the Site URL to www.tapinsafe.app."],
    ["Vercel: Invalid Configuration / Proxy Detected", "DNS record missing or orange cloud", "Add the record Vercel shows; set it to DNS only."],
], [44, 52, 74])

h1("Status and next steps")
table([
    ["Item", "Status"],
    ["Attendance, kiosk, offline, alerts, reports, dashboards, super admin", "Live"],
    ["Parent handover, bus children, code lock, late pickup, WhatsApp assistant", "Live (handover switched on per school)"],
    ["Lessons, monthly reports, safe pickup, QR passes, emergency roll call, school portal link", "Live"],
    ["Pricing, quotes, subscriptions, renewal reminders, card and kiosk orders", "Live: set your prices first"],
    ["Staff check-in security (PIN, photo, alerts, hours)", "Live (switched on per school)"],
    ["Offices and companies", "Live"],
    ["OPay online payment for invoices", "Ready: add the OPay keys"],
    ["Real WhatsApp number registration, templates, Meta business verification, Termii sender ID", "Waiting on accounts"],
], [110, 60])

# =========================================================================================== page furniture
def cover(c, d):
    c.saveState()
    c.setFillColor(DEEP); c.rect(0, 0, A4[0], A4[1], stroke=0, fill=1)
    c.setFillColor(TEAL); c.rect(0, 0, A4[0], 58 * mm, stroke=0, fill=1)
    c.setFillColor(GOLD); c.rect(25 * mm, A4[1] - 40 * mm, 18 * mm, 3, stroke=0, fill=1)
    c.restoreState()

def body(c, d):
    c.saveState()
    c.setFillColor(TEAL); c.rect(0, A4[1] - 5 * mm, A4[0], 5 * mm, stroke=0, fill=1)
    c.setFont("UI-SB", 8); c.setFillColor(MUTED)
    c.drawString(20 * mm, 11 * mm, "TapIn Operations Manual  ·  Version 2.0  ·  November 2026")
    c.drawRightString(A4[0] - 20 * mm, 11 * mm, str(d.page))
    c.setStrokeColor(LINE); c.setLineWidth(0.5); c.line(20 * mm, 15 * mm, A4[0] - 20 * mm, 15 * mm)
    c.restoreState()

doc = Doc(OUT, pagesize=A4, title="TapIn Operations Manual", author="TapIn", subject="Setup, operation and administration",
          leftMargin=20 * mm, rightMargin=20 * mm, topMargin=20 * mm, bottomMargin=22 * mm)
doc.addPageTemplates([
    PageTemplate("cover", [Frame(25 * mm, 20 * mm, A4[0] - 50 * mm, A4[1] - 40 * mm, id="c")], onPage=cover),
    PageTemplate("body", [Frame(20 * mm, 20 * mm, A4[0] - 40 * mm, A4[1] - 40 * mm, id="b")], onPage=body),
])
doc.multiBuild(story)
print("ok")
