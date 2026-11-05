# Projects under clients, standing teams and project stages (David, 5 Nov 2026)

David's decisions of 5 November, building on the projects note of 4 November (`2026-11-04-projects.md`). They are built in three parts.

## 1. Projects sit under clients (built 5 Nov, this pull request)

David: "Projects should be attached to a client, they can have multiple projects at a time. Projects are like a facility or a location added to a client. The project would be created in the roster with the ability to be isolated from other projects so it can be set up."

- A project belongs to a client, and a client can have several projects at once. In the data a project already is a site (`facilities.kind = 'project'`) with the client as its `client_id`, so nothing new is stored.
- A project can be created from the client's page (the client already chosen) or from the roster.
- On the roster a project is isolated by choosing it in the site picker: only its shifts, team and template show, and a new project's first week is a Draft, so it can be set up before anyone is told.
- Projects are reached under Clients in the menu rather than as a peer of it.

## 2. Standing teams (follow-up pull request)

- Teams belong to the company and are kept outside projects: a name, a trade make-up (for example 2 carpenters, 2 plasterers, 1 painter, 1 flooring, 1 labourer) and the named people in it.
- The trade make-up is the fallback: when a named person is away, the gap is the trade they fill.
- A project uses an established team or a newly created one, and the project's copy can be adjusted for that project without changing the standing team.

## 3. Project stages (built 5 Nov, follow-up pull request; migration 0093)

- A project has stages, for example Beach Hut: demolition and make good 4 days, build 9 days, clean 2 days.
- Each stage has its dates, its working days (Monday to Friday by default, with Saturday and Sunday optional per stage), its hours and its team.
- Stages may overlap when needed.
- One supervisor is assigned per project and works on it full time.
- Equipment and items are assigned to the project, and to a stage's dates.

Parts 2 (teams) and 3 (stages) were built in follow-up pull requests on 5 November.

### How stages were built (5 Nov)

- A stage (`project_stages`) belongs to a project: name, optional work area, first and last day, working days (Monday to Friday unless Saturday or Sunday are ticked), usual hours (or a shift type) and notes. Stages may overlap; the Stages tab shows them on a timeline, an overlapping stage on its own line.
- Changing a stage's last day can move the later stages (those starting after its old last day) by the same number of days, only when "Move later stages too" is ticked. Shifts already made stay where they are and the stage says how many now fall outside its dates.
- Choosing a standing team copies its make-up and its current people into the stage's own rows (`project_stage_roles`, `project_stage_people`), keeping the team as the source. The office then names or takes off people and changes the make-up for this stage only; the standing team never changes. A new team can be made from the stage form (it is kept on the Teams page too).
- One supervisor per project (`facilities.supervisor_worker_id`, a rostered person, separate from the office manager) is rostered on every working day of any stage, one shift a day even where stages overlap, from the earliest start to the latest finish of the stages that day, in a role of theirs that says supervisor (else their first role).
- "Roster this stage" and "Roster whole project" make ordinary shifts at the project for each working day: one per named person (as the shift's usual person, put on when eligibility passes) and one per gap in the make-up (left open in that role). The rest come back as left open with the first reason. A second press only adds what is missing; past days are left alone; the shifts are in the Draft roster, so nobody is told until the week is published.
- Ranking: people named for a stage, and the supervisor, count as the project's team for its shifts on the stage's dates (first within each eligibility group, never a block), without adding them to the project team list.
- "Book equipment for this stage" allocates equipment to the project for the stage's dates (refused like any allocation when it is elsewhere then). Items need nothing new: the project's stock shows on its Consumables tab.
