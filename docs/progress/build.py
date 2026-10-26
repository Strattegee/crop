import os
HERE=os.path.dirname(os.path.abspath(__file__))
import json
S=json.load(open(os.path.join(HERE,'schedule.json')))
import datetime
AS_AT=datetime.date.today().isoformat()
prog={
 'SCAN':('done',1,'24 Oct','Entire OnHire, Access Evo, Deputy and Logezy compared'),
 'SPEC':('done',1,'22 Oct','CROP MVP Specification written'),
 'ARCH':('done',1,'22 Oct','Build plan and technical decisions recorded'),
 'D2':('done',1,'22 Oct','CROP name, DigitalOcean hosting, Zitadel sign-in'),
 'ACC':('active',.95,None,'DigitalOcean, GitHub, cropwms.com, Zitadel, Resend email done. ClickSend number bought (26 Oct); its keys go on the server next'),
 'STORE':('active',.8,None,'Both accounts created. Apple is verifying the business'),
 'REPO':('done',1,'22 Oct','Code repository, automatic checks, auto-deploy to staging.cropwms.com'),
 'DM':('done',1,'22 Oct','Core data model built; extended module by module'),
 'SCH':('done',1,'22 Oct','Agencies, data separation between agencies, facilities'),
 'AUTH':('active',.85,None,'Sign-in, 2FA, roles and invitations done. Platform screen: add businesses and manage who can sign in, logged (26 Oct). Office audit log to do'),
 'PPL':('active',.4,None,'Worker profiles done. Employment records to do'),
 'DOC':('done',1,'24 Oct','Uploads stored privately in Sydney, opened by short-lived links'),
 'CRED':('done',1,'24 Oct','Credentials, rules, verification, right to work (VEVO), expiry reminders (people and equipment dates)'),
 'CLI':('active',.6,None,'Clients, facilities and areas done. Contacts and client rules to do'),
 'NOTE':('active',.7,None,'Email working. ClickSend number set; texts start once its keys are on the server. Push comes with the app'),
 'TPL':('active',.65,None,'Shift types (each business sets its own letter, name and standard hours; Settings → Shift types, 26 Oct), shifts (single or blocks) and equipment booked to shifts (with a person, or on its own for dry hire) built; equipment dates in the daily office email; items and consumables (PPE, fuel, sundries) with stock per site, issued to people or used on shifts, cost per shift; roster screen first version built'),
 'PUB':('active',.45,None,'Publish week and a change log of every shift change built (26 Oct); each business chooses who can change a published week (27 Oct); live updates and cost vs budget to do'),
 'GRID':('active',.88,None,'Ribbon roster on staging: coloured stage line on every shift, each shift type\'s letter (or A/P/N), leave lines, day totals, people strip with hours and balance and drag to assign, each business using its own words. Draft / Live / History with Publish week and a change log of every shift change (26 Oct). Day view (hour-by-hour timeline) and month view (calendar of daily totals) (27 Oct). Roster templates: save the usual week, fill any week from it or copy last week, with the usual people where they can work (27 Oct). Each business chooses who can change a published week: anyone in the office, only owners and admins, or nobody (27 Oct). Requesting and approving changes next'),
 'MATCH':('done',1,'26 Oct','Hard blocks and warnings, availability and leave, with screens: usual week, date changes, leave requests and approvals'),
 'BCAST':('active',.65,None,'Bank fill: open shifts offered to several bank and casual staff by email and text, first to accept is booked, no double booking. Staff accept or decline from a one-off link in the message, no sign-in needed. Uses availability and leave. Worker app to come'),
 'PROTO':('done',1,'26 Oct','Ribbon roster concept endorsed by Steve; first version built'),
}
rows=[]
for t in sorted(S['tasks'],key=lambda t:(t['es'],t['ef'])):
  st,pc,done,note=prog.get(t['id'],('todo',0,None,''))
  rows.append(dict(id=t['id'],name=t['name'],lane=t['lane'],who=t['who'],start=t['start'],end=t['end'],days=t['dur'],crit=t['crit'],status=st,pct=pc,done=done,note=note))
data=dict(asAt=AS_AT,tasks=rows,holidays=S['hol'])
html=open(os.path.join(HERE,'page.tpl.html')).read().replace('/*DATA*/null',json.dumps(data))
open(os.path.join(HERE,'crop-progress.html'),'w').write(html)
