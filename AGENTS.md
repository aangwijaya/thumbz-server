# AGENTS.md

## Role

You are working on the backend repository of this project.

The backend is responsible for:

* Business logic
* API implementation
* Authentication and authorization integration
* Data validation
* Database access
* External service integrations
* API contract implementation
* Backend tests

The frontend is maintained in a separate repository.

Do not modify the frontend repository unless explicitly requested.

---

## Source of Truth

Before implementing any task, read the relevant project documentation.

Priority order:

1. Explicit requirements from the current task
2. `design/DESIGN.md`
3. `PLAN.md`
4. `docs/API-CONTRACT.md` when available
5. Existing repository implementation and conventions
6. Relevant installed skills
7. Agent assumptions

When two documents conflict, follow the higher-priority source.

Do not invent requirements that are not supported by the documentation or current task.

---

## Project Documentation

### `design/DESIGN.md`

Defines the backend/product design requirements.

Use it to understand:

* Backend architecture
* Domain requirements
* Business rules
* Data model expectations
* Authentication and authorization requirements
* Infrastructure decisions
* Backend constraints

Do not rewrite or replace the design document during implementation unless explicitly requested.

### `PLAN.md`

Defines the planned implementation approach.

Use it to understand:

* Implementation phases
* Module boundaries
* Database work
* API implementation order
* Testing strategy
* Integration requirements

Follow the plan unless an implementation problem makes it impossible or unsafe to do so.

### `docs/API-CONTRACT.md`

Defines the contract between frontend and backend.

Treat this as the source of truth for FE/BE communication.

Before creating or modifying an API endpoint, check the API contract.

Do not casually change:

* Endpoint paths
* HTTP methods
* Request shapes
* Response shapes
* Authentication requirements
* Authorization requirements
* Error formats
* Pagination
* Filtering
* Sorting

If the implementation requires an API contract change:

1. Stop implementation of the affected change.
2. Explain why the contract must change.
3. Update the API contract first after approval.
4. Update the relevant implementation plan.
5. Then implement the change.

Never silently change the API contract.

---

# Architecture

Use the architecture defined by the project documentation.

The expected backend architecture is:

```text
Client
  ↓
NestJS API
  ↓
Business Logic
  ↓
Data / Integrations
  ↓
Supabase PostgreSQL
```

Supabase may provide infrastructure such as:

* PostgreSQL
* Authentication
* Storage
* Row Level Security

NestJS remains responsible for application and business logic.

Do not move business logic into Supabase merely because Supabase provides a feature that could technically implement it.

Use Redis only when there is a concrete requirement or measurable benefit.

Do not introduce microservices.

Prefer a modular monolith unless the project requirements explicitly justify another architecture.

---

# Coding Principles

## 1. Prefer stupid-simple code

Write code that is:

* Direct
* Explicit
* Readable
* Easy to debug
* Easy for another engineer to maintain

Prefer straightforward implementation over abstraction.

Do not optimize for cleverness.

---

## 2. No unnecessary abstraction

Do not create:

* Generic repositories without a real need
* Generic service layers that only forward method calls
* Excessive interfaces
* Factory abstractions without multiple implementations
* Utility wrappers around trivial operations
* Framework wrappers that provide no meaningful value
* Premature design patterns

Create an abstraction only when it solves an actual problem.

---

## 3. Avoid over-engineering

Do not add infrastructure or architecture simply because it is technically possible.

Examples:

* Do not introduce microservices.
* Do not introduce event-driven architecture without a real requirement.
* Do not add queues without a real asynchronous workload.
* Do not add Redis without a real caching requirement.
* Do not create CQRS without a demonstrated need.
* Do not create unnecessary domain layers.
* Do not add libraries for functionality that can be implemented simply with existing dependencies.

---

## 4. Keep modules explicit

NestJS modules should represent meaningful application/domain boundaries.

Prefer:

```text
auth/
users/
projects/
payments/
...
```

over deeply nested or artificially generic structures.

A module should have a clear responsibility.

Do not split a small feature into excessive files merely to satisfy an architectural pattern.

---

## 5. Database principles

Use PostgreSQL through the project's chosen Supabase setup.

Database design must:

* Follow `design/DESIGN.md`
* Follow `PLAN.md`
* Remain consistent with the API contract
* Use appropriate constraints
* Use appropriate indexes
* Preserve referential integrity
* Avoid unnecessary duplication

Do not modify the schema casually.

When changing the database schema, consider:

* Existing data
* Foreign keys
* Unique constraints
* Nullability
* Indexes
* Authorization implications
* API implications

Prefer explicit migrations over undocumented manual database changes.

---

# Authentication & Authorization

Authentication and authorization are different concerns.

Authentication answers:

> Who is this user?

Authorization answers:

> What is this user allowed to do?

Keep these concerns explicit.

Never assume that an authenticated user is automatically authorized to access a resource.

Every protected endpoint must validate the appropriate authorization requirements.

Do not trust:

* User IDs supplied by the client
* Roles supplied by the client
* Permission values supplied by the client
* Ownership claims supplied by the client

Derive security-sensitive information from trusted authentication/context and the database.

---

# API Rules

Every endpoint must have a legitimate product requirement.

Do not create speculative APIs.

Before implementing an endpoint, verify:

* Why does this endpoint exist?
* Which feature requires it?
* What authentication does it require?
* What authorization does it require?
* What request data does it accept?
* What response does it return?
* What errors can occur?

Follow `docs/API-CONTRACT.md`.

Keep API behavior predictable and explicit.

Use appropriate HTTP methods and status codes.

Do not expose internal implementation details in API responses.

---

# Validation

Validate external input at the API boundary.

Treat all client-provided data as untrusted.

Validate:

* Request body
* Query parameters
* Route parameters
* Authentication context where applicable
* IDs and identifiers
* Enum values
* Pagination values
* Filters
* Sort parameters

Do not rely on frontend validation for security or correctness.

Database constraints should still exist for important invariants.

---

# Error Handling

Errors should be:

* Predictable
* Explicit
* Safe to expose
* Consistent with the API contract

Do not expose:

* Stack traces
* Secrets
* Database credentials
* Internal infrastructure details
* Sensitive implementation information

Do not catch errors merely to rethrow them without adding meaningful context.

Avoid swallowing errors.

---

# External Data and Optional Values

Always use optional chaining (`?.`) when accessing properties on objects received from:

* APIs
* Requests
* External services
* DTOs or external payloads
* Other untrusted/external sources

Example:

```ts
user?.profile?.name
```

instead of:

```ts
user.profile.name
```

when the value may be `undefined` or `null`.

Do not blindly add optional chaining to values whose existence is guaranteed by an established internal invariant.

---

# Dependencies

Before adding a dependency:

1. Check whether the existing stack already provides the required functionality.
2. Check whether the functionality can be implemented simply without a dependency.
3. Confirm that the dependency is actually necessary.
4. Prefer small, well-maintained dependencies.

Do not add dependencies for convenience alone.

---

# Security

Never commit or expose:

* Secrets
* API keys
* Tokens
* Passwords
* Private credentials
* Production environment values

Use environment variables for secrets.

Do not log sensitive authentication or personal information.

Never trust authorization-related information from the client.

Security must be enforced server-side.

---

# Testing

Tests should focus on meaningful behavior.

Prioritize testing:

* Business rules
* Authorization
* Validation
* Important service behavior
* API behavior
* Database-related invariants
* Critical user flows

Do not create tests that merely reproduce implementation details.

Avoid excessive mocking when an integration test provides more useful confidence.

---

# Changes and Scope

Keep changes focused.

Do not modify unrelated files.

Do not perform opportunistic refactoring while implementing an unrelated feature.

If existing code is imperfect but does not block the requested feature, leave it alone unless fixing it is necessary.

Avoid large-scale rewrites unless explicitly requested.

---

# Architecture Changes

Do not change the established architecture casually.

If implementation reveals that the planned architecture is insufficient:

1. Stop before making a broad architectural change.
2. Explain the problem.
3. Identify the affected components.
4. Explain the proposed solution.
5. Check the API contract impact.
6. Update the relevant documentation/plan after approval.
7. Then implement.

Architecture changes must be deliberate.

---

# API Contract Changes

If a backend implementation requires a change to `docs/API-CONTRACT.md`:

```text
Identify problem
      ↓
Explain required change
      ↓
Review contract impact
      ↓
Update API contract
      ↓
Update FE/BE plans if necessary
      ↓
Implement
```

Do not modify the contract silently.

The frontend and backend are separate repositories, so the API contract is the boundary between them.

---
## Phased Implementation

Implementation must be performed **phase by phase**, not all at once.

Do not implement the entire `PLAN.md` in a single pass.

For each phase:

1. Read the relevant phase in `PLAN.md`.
2. Identify the smallest logical unit of work.
3. Implement only that unit.
4. Run the relevant validation:

   * Type checking
   * Linting
   * Unit/integration tests when applicable
   * Build when appropriate
5. Inspect the resulting diff.
6. Confirm the implementation is consistent with:

   * `design/DESIGN.md`
   * `PLAN.md`
   * `docs/API-CONTRACT.md`
   * Existing project conventions
7. Only after the current unit is verified, continue to the next unit.

### Do Not Batch Unrelated Work

Do not create or modify many unrelated files in a single step merely because they appear in the plan.

Prefer:

```text
Phase
  ↓
Small implementation unit
  ↓
Validate
  ↓
Review diff
  ↓
Next implementation unit
```

Instead of:

```text
Read PLAN.md
  ↓
Create 10–20 files
  ↓
Implement everything
  ↓
Run tests at the end
```

### Smallest Logical Unit

A logical unit should be small enough that its correctness can be understood and verified independently.

Examples:

```text
Create database migration
        ↓
Validate migration
        ↓
Create entity/model
        ↓
Validate types
        ↓
Create repository/data access
        ↓
Validate
        ↓
Create service/business logic
        ↓
Validate
        ↓
Create controller/API endpoint
        ↓
Run API tests
```

Do not create all of these layers simultaneously unless the task is genuinely trivial.

### Stop Between Units

After completing a logical unit, stop and verify the result before continuing.

If validation fails:

1. Fix the current unit.
2. Re-run validation.
3. Do not continue to the next unit until the current unit is stable.

Do not accumulate multiple known failures across phases.

### Respect Phase Boundaries

Do not jump ahead to later phases because the implementation appears easy.

If the current phase is:

```text
Database foundation
```

do not simultaneously implement:

```text
API controllers
Frontend integration
Authentication flows
```

unless the current task explicitly requires them.

### When a Phase Is Complete

Before moving to the next phase, verify:

* The phase requirements are implemented.
* Relevant tests pass.
* Type checking passes.
* Linting passes where configured.
* The code builds where applicable.
* The diff contains only expected changes.
* No unnecessary abstraction was introduced.
* No unrelated files were modified.
* No API contract was changed without approval.

Then proceed to the next phase.

### If the Plan Is Too Large

If a phase contains too much work to safely implement in one step, break it into smaller logical units yourself.

Do not interpret "phase" as permission to implement everything inside that phase at once.

The goal is **incremental, verifiable implementation**, not merely dividing a large implementation into named phases.

### Completion Reporting

After each logical unit, briefly report:

```text
Completed:
- What was implemented

Files changed:
- file/path
- file/path

Validation:
- Typecheck: PASS/FAIL
- Lint: PASS/FAIL
- Tests: PASS/FAIL

Next:
- The next logical unit from the current phase
```

Do not continue silently through multiple implementation units.

---

## Implementation Discipline

The agent should optimize for:

> Small change → verify → understand result → continue.

Not:

> Plan everything → generate everything → debug everything at the end.

A smaller verified change is preferred over a large unverified change.

---

# Installed Skills

Use installed skills when they are relevant to the current task.

Do not recreate installed skills inside the repository.

Do not create a `skills.md` file merely to document installed skills.

Do not duplicate skill documentation into `AGENTS.md`.

Use the appropriate installed skill when it provides specific knowledge or workflow guidance for the task.

---

# Implementation Workflow

For a normal feature:

```text
Read DESIGN.md
      ↓
Read PLAN.md
      ↓
Check API-CONTRACT.md
      ↓
Inspect existing implementation
      ↓
Implement the smallest correct change
      ↓
Run relevant tests
      ↓
Run type checking / linting
      ↓
Review the diff
```

Before finishing:

* Confirm the implementation follows the design.
* Confirm the implementation follows the plan.
* Confirm the API contract has not been violated.
* Confirm no unrelated files were changed.
* Confirm no unnecessary dependencies were introduced.
* Confirm no unnecessary abstractions were introduced.
* Confirm authentication/authorization requirements are enforced.
* Confirm tests and validation pass where applicable.

---

# Definition of Done

A backend task is complete when:

* The requested behavior is implemented.
* The implementation follows `design/DESIGN.md`.
* The implementation follows `PLAN.md`.
* The API follows `docs/API-CONTRACT.md`.
* Authentication and authorization are correctly enforced.
* External input is validated.
* Relevant tests pass.
* Type checking passes.
* Linting passes where configured.
* No secrets are exposed.
* No unrelated changes are included.
* The implementation remains simple and maintainable.

---

# Final Rule

When in doubt:

> Prefer the simplest implementation that correctly satisfies the requirements.

Do not add complexity to solve hypothetical future problems.

Do not assume requirements that were not specified.

Do not change architecture or API contracts without justification.

Build what is required, keep the boundaries explicit, and leave the codebase simpler rather than more complicated.
