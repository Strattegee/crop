# 2. DATA PROCESSING AGREEMENT (DPA)

This DPA forms part of the SaaS Subscription Agreement. It applies whenever Provider handles personal information on Customer’s behalf and separately recognises Provider’s own statutory responsibilities.

# 1. Roles and scope

## 1.1 Functional allocation

Customer determines the employment-related purposes of Customer Data and issues lawful instructions concerning processing. Provider processes that data to deliver the Services. For security records, billing, account administration, legal compliance and its own service operations, Provider may independently determine limited purposes and must meet its own applicable privacy duties.

## 1.2 Instructions

Provider shall process Customer Data only to deliver contracted Services, on documented Customer instructions, or as law requires. Where an instruction appears unlawful, Provider will notify Customer unless prohibited and may pause the affected processing while the parties resolve the issue.

## 1.3 Data categories

Subject to actual enabled functions, relevant data may include worker names, contact details, home or postal addresses (several per worker with one marked current; earlier addresses and corrections are kept as history, not overwritten; Provider works out on request an approximate straight-line distance from the current address's postcode to a site, to help Customer offer nearby shifts, shown only as a number of kilometres (to Customer's office users, and to the worker on shifts offered to them), never stored and never stopping anyone being offered or booked; beyond a distance Customer sets, workers who live further away are listed after nearer workers who are just as suitable; postcode locations are GeoNames data held by Provider, so no address leaves CROPwms for this), identifiers, role/employment status, shift allocations, attendance, timesheets, credential expiry dates, uploaded documents (credential evidence, and CVs, contracts or other documents Customer's office keeps on a worker's record), account usage, the push notification tokens of phones signed in to the CROPwms app, a log of phone calls Customer's office users record with workers and client contacts (when, which user, the outcome and an optional short note of up to 300 characters; Provider does not place or record calls), and audit events. Credential records may include police checks and vaccination records (health information) where Customer requires them for the work, and right to work records may include citizenship or visa status, visa expiry and work conditions. Worker records may include gender (female or male, optional), which Customer records so it can meet a client's request for a worker of a particular gender; a different or unrecorded gender is shown to Customer's office users as a warning and never decides who works a shift. Worker records may also include date of birth (optional), visible only to Customer's office users, which CROPwms uses to show Customer's office users a warning when a worker under 18 is put on a role or duty Customer has marked as 18 and over or on work between 10pm and 6am; it never decides who works a shift and is not shown in the app, included in messages or shared with another CROPwms customer. Where Customer is a staffing agency linked to another CROPwms customer, Customer instructs Provider to give that customer the name of each worker Customer puts forward, Customer’s name and the shift details, any reason Customer gives when it takes a worker off a shift, whether the worker met that customer’s requirements, and which of that customer’s listed credentials the worker held on the day of the shift (the credential’s name only); credentials, documents and contact details are not shared. Customer may also record the names and contact details of staffing agencies that do not use CROPwms and instruct Provider to email them a shift's details and requirements; those emails contain no worker information and give the sending user's name and work email so the agency can reply. When such an agency replies with a worker, Customer may record that worker's name against the agency and the shift; CROPwms does not check that worker's credentials or right to work, which remain the agency's responsibility. Where Customer supplies workers to its own clients, Customer may record each client order with the name, email address and phone number of the person at the client who placed it (and may save its clients' contacts, with their position and a short note, to reuse for later orders); where Customer switches on its public request page, a new customer's request (their organisation, name, email address, phone number, site address, the work needed and any note) is held for Customer to accept as a client or decline, and instruct Provider to email that person, when a worker is booked on the order, the worker's name (the first name they go by and their last name), the role and the shift's site, area, date and times; no other worker information is included. Where Customer opens its online application form, job applicants' applications (name, email address, mobile number, suburb and postcode, roles and kind of work wanted, usual availability, their own statement of whether they have the right to work and their status, without document numbers or visa details, whether they hold a driver's licence and a car, qualifications they say they hold with any files, a CV, a short note, how they heard of Customer, answers to Customer's own questions, and their agreement to the privacy policy and worker privacy notice with its version and time) are held unconfirmed until the applicant confirms their email address through a one-off link valid for 48 hours, after which they become an applicant record for Customer; unconfirmed applications are deleted after the link runs out. For spam protection Provider keeps a keyed hash of the applicant's IP address (never the address itself) and, when Customer's settings switch it on, uses Cloudflare Turnstile (Schedule D). Customer may limit its office users to chosen sites or projects and may give some users a supervisor role; CROPwms enforces those limits for every request, including in the database. A supervisor sees, for the sites or projects Customer gives them, workers' names, roles, credentials and licences (type, issuer, dates and verification status; vaccination records only as "a vaccination record"), whether right to work is met, the worker's work summary and their shifts there, and Customer's business-wide dashboard figures; not contact details, addresses (only the approximate distance from a worker's home postcode to a site), date of birth, right to work details, employment records, notes, documents, call logs or audit history. Fields involving biometrics, precise location, tax/bank/payroll information or minors are excluded from the approved launch scope until expressly documented and assessed.

# 2. Staff, security and support

## 2.1 Confidential access

Provider limits access to personnel and suppliers with a legitimate need, confidentiality obligations and appropriate privileges. Access is logged where practicable, reviewed, and revoked when no longer required.

## 2.2 Safeguards and audit

Provider maintains the Security Schedule controls, testing and proportionate documentation. Upon reasonable written request, Provider provides security summaries and relevant assurance evidence subject to confidentiality and reasonable protection of other tenants. Enhanced audits may be negotiated for regulated customers.

## 2.3 Individual rights and compliance assistance

Provider will reasonably assist Customer in responding to access, correction, complaints, regulatory requests and applicable breach obligations, taking account of the information and capabilities available to Provider. Provider will also handle requests relating to its own processing directly, and route employer-record requests appropriately.

# 3. Security incidents

## 3.1 Notice

Provider shall notify Customer without undue delay after becoming aware of a confirmed unauthorised access, disclosure, alteration, loss or other compromise affecting Customer Data; operational target within 24 hours of confirmation, with updates as material facts become known. Provider will also promptly alert Customer to credible suspected incidents that present a significant risk, even if investigation is incomplete.

## 3.2 Response

Provider will take appropriate containment and remediation steps; preserve relevant evidence; provide details reasonably available about affected data, timing, impacts and remedial actions; and coordinate notices. Neither party will unnecessarily delay legally required notification. The parties will designate leads for OAIC and worker communications as appropriate under the NDB scheme.

## 3.3 Costs and responsibility

Each party bears ordinary compliance costs, subject to any recoverable damages, agreed breach assistance costs and applicable liability provisions. No provision shifts responsibility for Provider-caused incidents to Customer merely because Customer is an employer.

# 4. Subprocessors and residency

## 4.1 Approved subprocessors

Provider may use disclosed subprocessors necessary to operate the Services. The actual current names, purposes, data locations and categories will appear at the subprocessor register in Schedule D of the Service Level, Security and Data Lifecycle Schedules or the attached register. Provider will impose written confidentiality, security and processing obligations appropriate to each subprocessor and remains responsible for their performance.

## 4.2 New subprocessors

Provider gives at least 30 days’ prior notice of material new subprocessors, except urgent security replacements, and a reasonable opportunity to object on documented privacy/security grounds. Parties will try to resolve objections; failing that, Customer may terminate the materially affected service with a pro-rata refund of unused prepaid fees.

## 4.3 Australian hosting

Primary production storage of Customer Data will be in Australia. This commitment does not represent an absolute prohibition on overseas access, transmission, telemetry, vendor support or disaster recovery unless confirmed in the register. Provider must disclose relevant cross-border flows and implement required safeguards. Any transfer of primary production storage outside Australia requires Customer’s prior written agreement.

# 5. Retention, exit and disclosure

## 5.1 Retention instructions

Provider retains Customer Data during the subscription and for the transition periods in the Data Lifecycle Schedule, unless required by Australian law or a lawful hold. Customer remains responsible for selecting retention settings consistent with employment obligations; Provider must not silently override agreed retention rules.

## 5.2 Exit

Customer shall have usable export functionality for relevant employee records and relevant audit metadata in commonly readable formats. Provider will offer reasonable cooperation where systems are unavailable. Deletion takes place only after the defined exit period and subject to legal obligations and backup cycles.

## 5.3 Government requests

Provider will examine compulsory disclosure requests for validity, disclose only what is legally required and, where legally permitted, notify Customer before disclosure.

## 5.4 Return/deletion certification

On a reasonable request after scheduled deletion, Provider will confirm completion or explain any retained categories, reasons and expected removal timelines. Provider must protect retained information and limit further processing.
