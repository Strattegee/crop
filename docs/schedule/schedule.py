"""Build schedule (https://claude.ai/artifact/RtUPeMVpHrJbUZZAms7Dug), source of truth.

Scheduled runs keep it current (docs/WORKING-ALONE.md step 7): when a task finishes, move it from `todo` to
`done` with its real start and end dates; change a duration or a notBefore date when a plan moves. Then run
`python3 docs/schedule/schedule.py` and publish docs/schedule/crop-schedule.html to the artifact.
Go-live is fixed by David (31 Oct): C4U prepares from Monday 4 January 2027 and goes live 11 January 2027.
"""
import json, os, datetime as dt
HERE = os.path.dirname(os.path.abspath(__file__))
D=dt.date
HOL={"2026-11-03":"Melbourne Cup","2026-12-25":"Christmas","2026-12-28":"Boxing Day (obs.)","2027-01-01":"New Year","2027-01-26":"Australia Day"}
def work(d): return d.weekday()<5 and d.isoformat() not in HOL
def nxt(d):
    d+=dt.timedelta(1)
    while not work(d): d+=dt.timedelta(1)
    return d
def prv(d):
    d-=dt.timedelta(1)
    while not work(d): d-=dt.timedelta(1)
    return d
def first(d):
    while not work(d): d+=dt.timedelta(1)
    return d
def P(s): return D.fromisoformat(s)
done=[
("SCAN","c1","Competitor scan","2026-10-26","2026-10-27","Claude"),
("ARCH","c1","Architecture and decision records","2026-10-26","2026-10-28","Claude"),
("SPEC","c1","MVP spec","2026-10-26","2026-10-29","Claude"),
("D2","you","Approve tech decisions","2026-10-29","2026-10-29","You"),
("ACC","you","Accounts: DigitalOcean, GitHub, domain, email, SMS","2026-10-26","2026-10-30","You"),
("REPO","c1","Repo, CI/CD, staging","2026-10-26","2026-10-28","Claude"),
("DM","c1","Data model, schema, row-level security","2026-10-26","2026-10-28","Claude"),
("AUTH","c1","Sign-in, 2FA, roles, audit log","2026-10-26","2026-10-31","Claude"),
("PPL","c2","Staff records, employment, employee card","2026-10-26","2026-10-31","Claude"),
("DOC","c2","Secure document storage","2026-10-27","2026-10-28","Claude"),
("CRED","c2","Credentials, requirements, expiry reminders","2026-10-26","2026-10-31","Claude"),
("ONB","c2","Onboarding, recruitment board, upload links","2026-10-29","2026-10-31","Claude"),
("TPL","c3","Templates, shift types, duties","2026-10-27","2026-10-29","Claude"),
("GRID","c3","Ribbon roster: day, week, month","2026-10-26","2026-10-31","Claude"),
("MATCH","c3","Matching, hard blocks, warnings, leave","2026-10-26","2026-10-30","Claude"),
("PUB","c3","Publish, change log, change requests","2026-10-26","2026-10-28","Claude"),
("NOTE","c4","Notifications: email and SMS","2026-10-27","2026-10-28","Claude"),
("APP","c4","Worker app and manager mode","2026-10-29","2026-10-31","Claude"),
("BCAST","c4","Offers to staff; accept with no double booking","2026-10-26","2026-10-30","Claude"),
("CLI","c6","Sites, areas, equipment, items, cover rules","2026-10-26","2026-10-29","Claude"),
("AGY","c6","Agency links and agency fill","2026-10-29","2026-11-02","Claude"),
("DASH","c5","Dashboards and daily email","2026-10-31","2026-10-31","Claude"),
]
todo=[
# id lane name dur deps who notBefore
("INFO","you","Supply decisions, C4U data and rules, legal details",9,[],"You + CFY team","2026-11-02"),
("STORE","you","Apple and Google developer accounts; Expo account",5,[],"You","2026-11-02"),
("LOGO","ext","Logo and colour palette",9,[],"Graphic designer","2026-11-02"),
("UIDES","ext","Overall look: key screens",14,[],"UI designer","2026-11-09"),
("APPLY","c2","Public apply form",4,["INFO"],"Claude",None),
("MIG","c1","Import C4U's staff, clients and templates",6,["INFO"],"Claude + you",None),
("CPORT","c6","Ordering for clients not on CROP",7,["INFO"],"Claude",None),
("PUSH","c4","Push alerts in the app",4,["STORE"],"Claude",None),
("OPS","c1","Production setup, backups, restore drill, monitoring",4,["INFO"],"Claude + you",None),
("LOOK","c2","Apply the new logo, colours and look",10,["LOGO","UIDES"],"Claude",None),
("FC","ms","Release 1 built: roster, allocations, credentialing",0,["APPLY","MIG","CPORT","PUSH","OPS"],"Milestone",None),
("PEN","ext","External penetration test (Release 1)",8,["FC"],"Security tester",None),
("FIX","c1","Fix test findings",4,["PEN"],"Claude",None),
("STOREREL","c4","App Store and Google Play review and release",8,["FC","STORE"],"Claude + you",None),
("TOS","ext","Lawyer reviews terms, privacy policy, data agreement",20,["INFO"],"Lawyer",None),
("TRIAL","you","C4U trial on staging with invented people",8,["FC"],"You + CFY team",None),
("PIL","you","Go-live prep: final import, checks, training",5,["FIX","TRIAL","TOS","STOREREL","LOOK"],"You + CFY team","2027-01-04"),
("LIVE","you","CFY live on roster, allocations, credentials",20,["PIL"],"You + CFY team",None),
("RATE","c6","Pay and charge rates, effective-dated",4,["FC"],"Claude",None),
("TS","c5","Timesheets from shifts, approval",5,["FC"],"Claude",None),
("REP","c5","Core reports",3,["TS"],"Claude",None),
("EXP","c5","Export to payroll system",4,["TS"],"Claude",None),
("CTS","c6","Client timesheet approval",3,["TS","CPORT"],"Claude",None),
("INVX","c6","Invoice export to Xero / MYOB",4,["RATE","CTS"],"Claude",None),
("R2","ms","Release 2 built: timesheets, pay and invoice export",0,["EXP","INVX","REP"],"Milestone",None),
("AWD","ext","Award / payroll specialist check",5,["EXP"],"Specialist","2027-01-04"),
("SEC2","ext","Security retest of Release 2 changes",3,["R2","FIX"],"Security tester","2027-01-04"),
("BILL","c5","Subscription billing for paying customers",4,["R2"],"Claude",None),
("GO2","you","Switch timesheets, pay and invoicing to CROP",5,["SEC2","AWD","LIVE?"],"You + CFY team","2027-01-25"),
("CYC","you","Run one full pay and invoice cycle end to end",10,["GO2"],"You + CFY team",None),
("INV","ms","Beta signed off: ready to sell",0,["LIVE","CYC","BILL"],"Milestone",None),
]
T={}
for i,l,n,s,e,w in done:
    T[i]=dict(id=i,lane=l,name=n,dur=0,deps=[],who=w,done=True,start=s,end=e,crit=False,float=0,lateEnd=e)
    d=P(s);c=1
    while d<P(e): d=nxt(d);c+=1
    T[i]["dur"]=c
order=[]
for i,l,n,dur,deps,w,nb in todo:
    deps=[x for x in deps if not x.endswith("?")]
    T[i]=dict(id=i,lane=l,name=n,dur=dur,deps=deps,who=w,done=False,nb=nb)
    order.append(i)
# forward: start = first working day after all deps end (milestones end = their date)
fin={}
for i in order:
    t=T[i]
    cands=[first(P(t["nb"]))] if t["nb"] else [first(P("2026-11-02"))]
    for d in t["deps"]:
        dd=T[d]
        cands.append(P(dd["start"]) if dd["dur"]==0 else nxt(P(dd["end"])))
    s=max(cands)
    if t["dur"]==0: e=s
    else:
        e=s
        for _ in range(t["dur"]-1): e=nxt(e)
    t["start"]=s.isoformat(); t["end"]=e.isoformat()
# backward from INV
succ={i:[j for j in order if i in T[j]["deps"]] for i in order}
le={}
for i in reversed(order):
    t=T[i]
    if not succ[i]: L=P(t["end"])
    else:
        opts=[]
        for j in succ[i]:
            u=T[j]; ls=le[j]
            for _ in range(max(u["dur"]-1,0)): ls=prv(ls)
            # latest start of successor ls; this must end before it
            opts.append(ls if u["dur"]==0 else prv(ls))
        L=min(opts)
        if t["dur"]==0: L=L if L>=P(t["end"]) else P(t["end"])
    le[i]=L
    t["lateEnd"]=max(L,P(t["end"])).isoformat()
    f=0;d=P(t["end"])
    while d<P(t["lateEnd"]): d=nxt(d);f+=1
    t["float"]=f; t["crit"]=f==0
base=P("2026-10-26")
def widx(s):
    d=base;c=0
    while d<P(s): d+=dt.timedelta(1); c+= work(d)
    return c
out=[]
for t in T.values():
    t.pop("nb",None); t["es"]=widx(t["start"]); t["ef"]=t["es"]+t["dur"]
    out.append(t)
data={"tasks":out,"start":"2026-10-26","hol":HOL,"endDate":T["INV"]["end"]}


# Page: page.tpl.html is the original page; the replacements below turn it into the revised one.
import re
d = data
CRIT = {"PIL", "LIVE", "GO2", "CYC", "INV"}
for t in d["tasks"]:
    t["crit"] = t["id"] in CRIT
s = open(os.path.join(HERE, 'page.tpl.html')).read()
m = re.search(r'<body>(.*)</body>', s, re.S)
body = m.group(1) if m else s
body = re.sub(r'const DATA = \{.*?\};\n', lambda _: 'const DATA = ' + json.dumps(d) + ';\n', body, flags=re.S)

def rep(a, b):
    global body
    assert a in body, a[:60]
    body = body.replace(a, b)

rep('<p class="lede">Six Claude build streams run in parallel under your control, with Caring For You as the beta client. Release 1 delivers what a nursing agency needs first: roster, allocations and credentialing. Release 2 adds timesheets, pay and invoice export. Red is the critical path: any delay there moves the finish date. Grey tails show how far other tasks can slip without moving it. Click a bar for its details, dependencies and slack.</p>',
    '<p class="lede"><b>Revised 31 October 2026.</b> Most of Release 1 was built in the first week, so Caring For You now goes live on <b>Monday 11 January 2027</b>, after the Christmas and New Year quiet period (David, 31 Oct). Faded bars are done. Red is the path to that date and on to ready to sell. Grey tails show how far a task can slip before it moves go-live. Click a bar for its details, dependencies and slack.</p>')
rep('.bar.crit{background:var(--crit)}', '.bar.crit{background:var(--crit)}\n.task.done .bar{opacity:.35}\n.task.done .lab .nm{color:var(--muted)}')

old_tiles = re.search(r'\$\("#tiles"\)\.innerHTML = \[.*?\]\.map', body, re.S).group(0)
body = body.replace(old_tiles, '''$("#tiles").innerHTML = [
    ["Build started", fmtY(DATA.start), "Decisions made 22 Oct"],
    ["Done so far", T.filter(t => t.done).length + " tasks", "In the first week"],
    ["Release 1 built", fmtY(fc.start), "Was 29 Dec 2026"],
    ["CFY live on Release 1", fmtY(live.start), "Was 22 Jan 2027", true],
    ["Timesheets and pay switched", fmtY(byId.GO2.end), "Was 29 Jan 2027"],
    ["Ready to sell", fmtY(inv.start), "Was 22 Feb 2027"]
  ].map''')

rep('h += `<div class="row task" data-id="${t.id}">', 'h += `<div class="row task${t.done?" done":""}" data-id="${t.id}">')
rep('<span class="kv">Slack <b>${t.crit ? "none" : t.float + " working days"}</b></span>',
    '<span class="kv">${t.done ? "Status <b>Done</b>" : `Slack <b>${t.float ? t.float + " working days" : "none"}</b>`}</span>')
rep('const fl = !t.crit && t.lateEnd > t.end', 'const fl = !t.done && t.lateEnd > t.end')
rep('(t.crit||t.lateEnd<=t.end?6:', '(t.done||t.lateEnd<=t.end?6:')
rep('const chain = T.filter(t => t.crit)', 'const chain = T.filter(t => t.crit && !t.done)')

old_crit = re.search(r'<h2>Critical path</h2>.*?</p>', body, re.S).group(0)
body = body.replace(old_crit, '''<h2>Path to go-live</h2>
      <div class="chain" id="chain"></div>
      <p style="margin-top:10px;color:var(--muted)">Go-live is set by the calendar, not the build: everything before Christmas has about three weeks of slack, so nothing before then is on the critical path. The penetration test should now be booked for late November or early December rather than over Christmas. The lawyer's review needs the company details from the list first.</p>''')

old_sooner = re.search(r'<h2>Ways to finish sooner</h2>.*?</ol>', body, re.S).group(0)
body = body.replace(old_sooner, '''<h2>What keeps 11 January safe</h2>
      <ol>
        <li>Send the items on "CROP: what we need from you" within two weeks (by 13 November).</li>
        <li>Book the penetration tester for 25 November to 4 December.</li>
        <li>Create the Expo account and finish the Apple and Google accounts, so the app goes to the stores in late November, before reviews slow down for Christmas.</li>
        <li>Send the legal drafts to the lawyer by mid-November.</li>
        <li>If the UI designer's screens run late, go live on the current layout with the new logo and colours, and roll out the full look afterwards.</li>
      </ol>''')

rep("<li>Your review time is the real limit. Six streams peak in early December. If that's too many to review, pause the streams with slack first; the critical ones keep going.</li>",
    "<li>December is spare: Release 2 (timesheets, pay, invoice export) is built then, and C4U trials Release 1 on staging with invented people.</li>")
rep("No Christmas shutdown is assumed for the build: a two-week break moves everything after 18 December out by about two weeks.",
    "C4U's go-live preparation starts on Monday 4 January; nothing new reaches C4U between Christmas and New Year.")
rep("Estimates will tighten after the first two weeks of real build speed.", "The revised dates use the first week's real build speed.")
rep('<span><i style="--c:var(--crit)"></i>Critical path</span>', '<span><i style="--c:var(--crit)"></i>Critical path (from go-live on)</span>')
rep('Slack before it delays the finish</span>', 'Slack before it delays go-live</span>')
open(os.path.join(HERE, 'crop-schedule.html'), 'w').write(body)
print("Release 1 built", T["FC"]["start"], "| go-live", T["LIVE"]["start"], "| ready to sell", T["INV"]["start"])
