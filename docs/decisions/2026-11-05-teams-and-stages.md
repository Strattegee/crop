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

## 3. Project stages (follow-up pull request)

- A project has stages, for example Beach Hut: demolition and make good 4 days, build 9 days, clean 2 days.
- Each stage has its dates, its working days (Monday to Friday by default, with Saturday and Sunday optional per stage), its hours and its team.
- Stages may overlap when needed.
- One supervisor is assigned per project and works on it full time.
- Equipment and items are assigned to the project, and to a stage's dates.

Parts 2 (teams) and 3 (stages) are built in follow-up pull requests.
