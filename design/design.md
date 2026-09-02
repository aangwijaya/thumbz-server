# THUMBZ Design System

> **Authoritative visual and UX specification for THUMBZ**

---

## 1. Design Authority

This document is the **single source of truth for the visual design and UX direction of THUMBZ**.

Reference materials are available at:

```text
design/references/steep.md
design/references/monad.md
```

These files are **reference materials only**.

They are not independent THUMBZ design systems and must not be reproduced literally.

### Design precedence

When making visual or UX decisions, follow this hierarchy:

1. THUMBZ-specific rules in this document
2. Page-specific design composition defined in this document
3. Component-specific rules defined in this document
4. Referenced principles from `design/references/steep.md`
5. Referenced principles from `design/references/monad.md`
6. General design judgment

If a reference conflicts with a THUMBZ rule, **THUMBZ rules always win**.

If Steep and Monad conflict with each other, do not arbitrarily combine them. Follow the page or component composition defined in this document.

Do not copy either reference design wholesale.

---

# 2. Product Identity

## Product

**THUMBZ**

THUMBZ is a premium Mobile Legends esports streaming and content platform.

The product combines:

* esports streaming
* match discovery
* tournament information
* team profiles
* player profiles
* match statistics
* esports analytics
* replay and video content

The primary user journey is:

```text
Discover
   ↓
Browse
   ↓
Find a match
   ↓
Watch
   ↓
Understand the match
   ↓
Explore statistics / teams / players
```

---

# 3. Visual Philosophy

THUMBZ combines three visual languages:

```text
Editorial
    +
Technical
    +
Streaming
```

The final result should feel:

* premium
* modern
* editorial
* technical
* confident
* restrained
* esports-focused
* information-rich

THUMBZ should feel like a **real commercial product**, not a portfolio dashboard or UI exercise.

---

# 4. Design Languages

## 4.1 Editorial

### Reference

```text
design/references/steep.md
```

Steep is the primary reference for the editorial visual language.

Use its principles rather than copying its visual identity.

### Use Editorial language for

* page headlines
* section hierarchy
* featured content
* team profiles
* player profiles
* tournament presentation
* content discovery
* large content cards
* editorial compositions
* visual storytelling

### Characteristics

* strong typography hierarchy
* intentional whitespace
* large visual blocks
* sophisticated card composition
* editorial rhythm
* asymmetric or varied layouts where appropriate
* clear visual hierarchy

### Avoid

* blindly copying Steep's colors
* blindly copying its typography
* reproducing its layouts
* reproducing its illustrations
* making THUMBZ look like Steep

Steep is a **design reference**, not a template.

---

# 4.2 Technical

### Reference

```text
design/references/monad.md
```

Monad is the primary reference for technical and data-oriented UI.

### Use Technical language for

* match metadata
* statistics
* timestamps
* score information
* performance metrics
* player statistics
* tournament statistics
* technical labels
* compact information
* data visualization

### Characteristics

* precise alignment
* compact metadata
* monospace information where appropriate
* thin borders
* numerical hierarchy
* technical labels
* restrained UI
* high information clarity

### Avoid

* turning the entire application into a dashboard
* excessive monospace typography
* excessive data density
* copying Monad's visual identity
* using technical styling for content that should feel editorial

---

# 4.3 Streaming

Streaming is a **THUMBZ-specific design language**.

It does not derive directly from Steep or Monad.

Use it for:

* video player
* live streams
* live match cards
* stream thumbnails
* playback controls
* watch actions
* viewing states
* live indicators

### Characteristics

* dark surfaces
* cinematic imagery
* strong contrast
* immersive video areas
* clear LIVE state
* minimal visual distraction
* strong media hierarchy

The streaming experience should feel immersive without becoming a generic Netflix or Twitch clone.

---

# 5. Design Composition

Different pages use different combinations of the three design languages.

The percentages below indicate **visual priority**, not literal CSS proportions.

---

## Homepage

```text
Editorial     60%
Streaming     30%
Technical     10%
```

### Primary

Editorial

### Secondary

Streaming

### Tertiary

Technical

### Purpose

The homepage is primarily a **content discovery experience**.

It must not look like an analytics dashboard.

### Sections

1. Navigation
2. Featured live match
3. Live now
4. Upcoming matches
5. Featured tournaments
6. Popular teams
7. Latest content
8. Continue watching

### Featured Live Match

Prioritize:

* cinematic visual
* teams
* score
* tournament
* match state
* LIVE indicator
* viewer count
* watch action

### Match Cards

Use:

* editorial composition
* compact technical metadata
* minimal statistics
* strong visual hierarchy

### Avoid

* dense tables
* KPI dashboards
* excessive charts
* sidebar dashboard navigation

---

# 6. Live Page

```text
Streaming     55%
Editorial     30%
Technical     15%
```

### Primary

Streaming

### Purpose

Allow users to immediately discover what is currently live.

### Content

* live matches
* stream thumbnails
* team information
* tournament
* viewer count
* match status
* watch action

### Visual Priority

The stream thumbnail and LIVE state should dominate.

Technical metadata should remain compact.

---

# 7. Match Detail

```text
Streaming     55%
Technical     25%
Editorial     20%
```

### Primary

Streaming

### Secondary

Technical

### Tertiary

Editorial

This is the **core THUMBZ experience**.

The user should immediately understand:

* who is playing
* current score
* match status
* tournament
* where to watch

### Layout

```text
Match Header
     ↓
Video Player
     ↓
Match Navigation
     ↓
Overview / Statistics / Roster / History
     ↓
Related Matches
```

### Match Header

Display:

* Team A
* Team B
* score
* match status
* tournament
* stage
* game number
* scheduled time when applicable

### Video Player

The player should dominate the page.

The player is a THUMBZ-specific component.

Do not copy Steep or Monad for the player.

### Statistics

Use Monad-inspired technical principles for:

* numerical hierarchy
* compact labels
* alignment
* metadata
* performance metrics

THUMBZ design rules always override Monad.

---

# 8. Tournament Pages

```text
Editorial     45%
Technical     40%
Streaming     15%
```

## Tournament List

Focus on:

* tournament identity
* status
* dates
* region
* prize information where available
* featured matches

## Tournament Detail

Sections may include:

* overview
* schedule
* standings
* bracket
* teams
* results
* stages
* related streams

### Design

Use editorial hierarchy for tournament identity.

Use technical language for:

* standings
* statistics
* schedules
* match results
* rankings

Use streaming language for playable/live content.

---

# 9. Team Pages

```text
Editorial     40%
Technical     35%
Streaming     25%
```

### Primary Focus

Team identity.

Display:

* team logo
* team name
* region
* roster
* current form
* recent matches
* upcoming matches
* statistics
* tournament participation

### Editorial

Use for:

* team identity
* hero/profile area
* typography
* visual hierarchy

### Technical

Use for:

* win rate
* match statistics
* performance metrics
* rankings

### Streaming

Use for:

* recent match thumbnails
* live match
* watch actions

---

# 10. Player Pages

```text
Editorial     45%
Technical     55%
Streaming     0–10%
```

Player pages are more information-oriented than team pages.

Display:

* player identity
* role
* current team
* statistics
* recent matches
* tournament history

Use technical language for numerical information.

Use editorial language for player identity and content hierarchy.

Streaming should only appear when there is relevant playable content.

---

# 11. Search

```text
Technical     40%
Editorial     40%
Streaming     20%
```

Search must support:

* matches
* teams
* players
* tournaments
* content

Example:

```text
/search?q=onic&type=team
```

Search state should be URL-driven and shareable.

### Results

Use editorial cards for major entities.

Use technical metadata for:

* result type
* status
* date
* statistics
* match information

---

# 12. Navigation

The navigation should be simple and product-oriented.

Primary navigation:

```text
THUMBZ

Live
Matches
Tournaments
Teams
Players

Search
```

Authenticated users may have:

```text
Profile
Favorites
Watch History
```

### Avoid

* dashboard sidebar as the primary navigation
* excessive nested menus
* unnecessary navigation items

The product should feel like a streaming/content platform rather than an enterprise dashboard.

---

# 13. Color System

THUMBZ should use a dark-first visual system.

Suggested foundation:

```text
Background
#0A0A0A

Surface
#111111

Surface Elevated
#181818

Text Primary
#F5F5F5

Text Secondary
#A1A1AA

Border
#27272A
```

These values are starting points, not immutable requirements.

---

## Semantic Colors

### Live

Use a clear warm/red semantic indicator.

```text
LIVE
●
```

LIVE should be immediately recognizable.

### Success

For positive states such as:

* victory
* successful operation
* positive performance

### Warning

For:

* upcoming states
* delayed content
* degraded conditions

### Error

For:

* playback failures
* API failures
* unavailable content

Semantic colors should be restrained.

Do not turn the entire interface into a neon gaming aesthetic.

---

# 14. Team Colors

Team colors are **contextual**, not THUMBZ brand colors.

For example:

```text
ONIC → team-specific accent
RRQ  → team-specific accent
EVOS → team-specific accent
```

Team colors may be used for:

* subtle accents
* indicators
* team identity
* charts
* contextual highlights

Do not allow team colors to override the THUMBZ design system.

---

# 15. Typography

THUMBZ should use three typographic roles.

## Display

Editorial / serif-oriented typography.

Use for:

* major headlines
* featured content
* page titles
* editorial statements

The exact font should be selected during implementation based on availability, performance, licensing, and overall visual fit.

---

## Body

Modern sans-serif.

Use for:

* descriptions
* navigation
* buttons
* normal UI content
* supporting text

---

## Technical

Monospace.

Use selectively for:

* timestamps
* scores
* match metadata
* statistics
* technical labels
* numerical information

Do not use monospace for the entire interface.

---

# 16. Spacing

Use a consistent spacing scale.

Prioritize:

* generous spacing between major sections
* tighter spacing inside technical components
* clear separation between content groups
* consistent card padding

Editorial areas should breathe.

Technical areas may be denser.

---

# 17. Cards

Cards are important THUMBZ primitives.

Cards should not all have identical visual treatment.

Use different card compositions for:

* matches
* streams
* teams
* players
* tournaments
* content

### General principles

* clear hierarchy
* strong image/content relationship
* restrained borders
* intentional spacing
* meaningful hover states
* avoid excessive shadows

Do not make every element a card.

---

# 18. Data Visualization

Charts should be used when they communicate meaningful information.

Good candidates:

* team performance
* player performance
* win rate
* historical results
* tournament progress

Avoid charts merely to make the interface look technical.

Prefer:

* simple
* readable
* contextual
* visually integrated

Do not create a dashboard full of arbitrary graphs.

---

# 19. Video Player

The video player is a **THUMBZ-specific component**.

Design priorities:

1. Video
2. Playback controls
3. Live state
4. Match context
5. Secondary controls

The player should support a future Shaka Player implementation.

The design must accommodate:

* live playback
* replay
* loading
* buffering
* playback errors
* quality selection
* fullscreen
* picture-in-picture where supported
* unavailable streams

The visual design must remain usable without relying on JavaScript-rendered decorative elements.

---

# 20. Live State

LIVE is a first-class product state.

A live match should clearly communicate:

```text
● LIVE
24.8K WATCHING
```

Live indicators should be:

* visible
* consistent
* restrained
* semantically meaningful

Do not overuse animated flashing effects.

---

# 21. Loading States

Every data-driven page should have intentional loading states.

Use:

* skeletons
* reserved media dimensions
* stable layouts

Avoid:

* layout jumps
* blank screens
* arbitrary spinners everywhere

---

# 22. Empty States

Empty states should explain:

* what is missing
* why it may be missing
* what the user can do next

Avoid generic:

```text
No data found.
```

when more useful context is available.

---

# 23. Error States

Errors should be understandable to users.

Do not expose:

* stack traces
* raw API responses
* technical error objects

Provide appropriate recovery actions such as:

* retry
* go back
* return home
* try another match

---

# 24. Responsive Design

THUMBZ must support:

* desktop
* laptop
* tablet
* mobile

Responsive design must be intentional.

Do not simply shrink desktop layouts.

---

## Mobile Priorities

Mobile users should quickly access:

1. Live
2. Matches
3. Video
4. Match information

Avoid excessive desktop-style density on mobile.

Statistics may become:

```text
desktop:
multi-column

mobile:
stacked sections
```

---

# 25. Motion

Motion should communicate state and interaction.

Good uses:

* card hover
* page transitions
* live state
* loading
* expanding information
* player controls

Avoid:

* excessive animations
* distracting background motion
* constant pulsing
* unnecessary parallax

Motion should never interfere with content consumption.

Respect reduced-motion preferences.

---

# 26. Accessibility

Accessibility is part of the visual system.

Requirements:

* semantic HTML
* keyboard navigation
* visible focus states
* accessible buttons
* accessible links
* proper labels
* sufficient contrast
* appropriate ARIA usage
* reduced motion support

Do not use clickable `<div>` elements when a semantic element is appropriate.

---

# 27. Component Design Principles

Components should have a clear visual responsibility.

Potential primitives:

```text
MatchCard
LiveMatchCard
StreamCard
TeamCard
PlayerCard
TournamentCard
SectionHeader
StatusBadge
ScoreDisplay
StatCard
StatTable
VideoPlayer
```

Do not create components merely to split code into arbitrary files.

A component should exist when it provides:

* reuse
* meaningful visual responsibility
* meaningful behavior
* domain clarity

---

# 28. Design Consistency Rules

The following rules are mandatory:

### Do

* preserve the THUMBZ visual hierarchy
* use the assigned design language for each page
* reuse established components
* maintain consistent spacing
* maintain consistent semantic states
* use reference documents intentionally
* prioritize content hierarchy

### Do not

* randomly mix Steep and Monad characteristics
* copy either reference wholesale
* introduce unrelated UI styles
* use default shadcn styling without adaptation
* create a generic SaaS dashboard
* create a generic gaming/neon interface
* create a Twitch clone
* create a Netflix clone

---

# 29. Reference Mapping

| Area         | Primary   | Secondary | Reference     |
| ------------ | --------- | --------- | ------------- |
| Homepage     | Editorial | Streaming | Steep         |
| Live         | Streaming | Editorial | THUMBZ        |
| Match        | Streaming | Technical | Monad         |
| Tournament   | Editorial | Technical | Steep + Monad |
| Team         | Editorial | Technical | Steep + Monad |
| Player       | Technical | Editorial | Monad + Steep |
| Search       | Editorial | Technical | Steep + Monad |
| Video Player | Streaming | —         | THUMBZ        |
| Statistics   | Technical | Editorial | Monad         |
| Navigation   | Editorial | Streaming | THUMBZ        |

---

# 30. Final Design Principle

THUMBZ should not look like a collection of borrowed design systems.

The references exist to provide design vocabulary.

The final product must have its own identity.

The intended visual result is:

```text
              THUMBZ
                 │
       ┌─────────┼─────────┐
       │         │         │
   Editorial  Technical  Streaming
       │         │         │
     Steep      Monad      THUMBZ
   reference   reference   original
       │         │         │
       └─────────┼─────────┘
                 │
                 ▼
          ONE CONSISTENT UI
```

The goal is:

> **Editorial sophistication + technical credibility + immersive esports streaming.**

Not:

> Steep + Monad pasted together.

THUMBZ must ultimately feel like one coherent product.
