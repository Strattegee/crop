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
 'ACC':('active',.9,None,'DigitalOcean, GitHub, cropwms.com, Zitadel, Resend email done. ClickSend number to buy on Monday'),
 'STORE':('active',.8,None,'Both accounts created. Apple is verifying the business'),
 'REPO':('done',1,'22 Oct','Code repository, automatic checks, auto-deploy to staging.cropwms.com'),
 'DM':('done',1,'22 Oct','Core data model built; extended module by module'),
 'SCH':('done',1,'22 Oct','Agencies, data separation between agencies, facilities'),
 'AUTH':('active',.8,None,'Sign-in, 2FA, roles and invitations done. Audit log to do'),
 'PPL':('active',.4,None,'Worker profiles done. Employment records to do'),
 'DOC':('done',1,'24 Oct','Uploads stored privately in Sydney, opened by short-lived links'),
 'CRED':('done',1,'24 Oct','Credentials, rules, verification, right to work (VEVO), expiry reminders (people and equipment dates)'),
 'CLI':('active',.6,None,'Clients, facilities and areas done. Contacts and client rules to do'),
 'NOTE':('active',.6,None,'Email working. Texts ready once the ClickSend number is set up. Push comes with the app'),
 'TPL':('active',.6,None,'Shift codes, shifts (single or blocks) and equipment booked to shifts (with a person, or on its own for dry hire) built; equipment dates in the daily office email; items and consumables (PPE, fuel, sundries) with stock per site, issued to people or used on shifts, cost per shift; roster screen next'),
 'GRID':('active',.2,None,'Roster data with hours per person and per piece of equipment built; screen next'),
 'MATCH':('active',.6,None,'Hard blocks (role, credentials on the shift date, right to work, double booking, visa hours, equipment operator licences) and rest warnings done; who-can-work list built. Leave comes with availability'),
 'BCAST':('active',.5,None,'Bank fill: open shifts offered to several bank and casual staff by email and text, first to accept is booked, no double booking. Staff reply to the office until the worker app is ready'),
 'PROTO':('active',.3,None,'Ribbon roster prototype done. Roster session with David next'),
}
rows=[]
for t in sorted(S['tasks'],key=lambda t:(t['es'],t['ef'])):
  st,pc,done,note=prog.get(t['id'],('todo',0,None,''))
  rows.append(dict(id=t['id'],name=t['name'],lane=t['lane'],who=t['who'],start=t['start'],end=t['end'],days=t['dur'],crit=t['crit'],status=st,pct=pc,done=done,note=note))
data=dict(asAt=AS_AT,tasks=rows,holidays=S['hol'])
html=open(os.path.join(HERE,'page.tpl.html')).read().replace('/*DATA*/null',json.dumps(data))
open(os.path.join(HERE,'crop-progress.html'),'w').write(html)
