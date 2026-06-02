# Skillforge

<img src="./assets/skillforge-banner.png" alt="Skillforge — skill packs for Claude Code" width="100%" />

Skill packs for Claude Code and other LLM agent systems, published by [Entelligentsia](https://github.com/Entelligentsia) ([entelligentsia.in](https://entelligentsia.in)).

## Available Packages

| Package | Type | Description |
|---------|------|-------------|
| [forge](https://github.com/Entelligentsia/forge) | Meta-generator | Self-enhancing AI software development lifecycle — scans your codebase, generates project-specific workflows, personas, templates, and tools |
| [security-watchdog](./security-watchdog/) | Security plugin | Auto-scans newly installed/updated Claude Code plugins for prompt injection, malicious hook scripts, and data exfiltration |
| [freshdesk-api](./freshdesk-api/) | API integration skill | Freshdesk helpdesk API — tickets, contacts, companies, knowledge base (Solutions), webhooks (1 skill) |
| [doc-review](./doc-review/) | Workflow plugin | In-browser document annotation overlay with Claude-driven apply — annotate HTML/MD/TXT in browser, click Apply, edits land in source (1 skill, 4 commands) |
| [design-patterns](./design-patterns/) | Reference skills | Canonical software design patterns — all 23 GoF + enterprise/DDD patterns (10 skills) |
| [llm-patterns](./llm-patterns/) | Reference skills | LLM integration patterns — RAG, tool use, agents, guardrails, tool synthesis (9 skills) |
| [harness-engineering](./harness-engineering/) | Reference skills | Agent harness components — memory/compaction, caching, sandboxing, permissions, telemetry, hooks, routing (13 skills) |
| [meta-webxr-skills](./meta-webxr-skills/) | Reference skills | Meta Quest PWA XR engineering (8 skills) |
| [threejs-skills](./threejs-skills/) | Reference skills | Three.js 3D development (10 skills) |
| [lean-ctx-eval](./lean-ctx-eval/) | Eval skill | Measure whether the lean-ctx MCP saves more context tokens than it costs, from your own Claude Code session transcripts (1 skill) |

## Installation (Claude Code)

```
/plugin marketplace add Entelligentsia/skillforge
```

Then install whichever packs you need:

```
/plugin install security-watchdog@skillforge
/plugin install freshdesk-api@skillforge
/plugin install doc-review@skillforge
/plugin install design-patterns@skillforge
/plugin install llm-patterns@skillforge
/plugin install harness-engineering@skillforge
/plugin install threejs-skills@skillforge
/plugin install meta-webxr-skills@skillforge
/reload-plugins
```

### Forge

Forge has its own repository. See [Entelligentsia/forge](https://github.com/Entelligentsia/forge) for installation instructions.

## Forge

Forge is different from the reference skill packages. Instead of loading knowledge into context, it **generates** a complete project-specific engineering practice: agent personas, workflows, templates, review checklists, and tools — all tailored to your stack.

```bash
/forge init          # Bootstrap SDLC into your project
/sprint-plan         # Start your first sprint (generated command)
/engineer ACME-S01-T01   # Plan a task (generated command)
```

See [Entelligentsia/forge](https://github.com/Entelligentsia/forge) for the full vision and design.

## Skills Index

### security-watchdog

| Skill / Command | Purpose |
|-----------------|---------|
| `/security-watchdog:scan-plugin <plugin-id>` | Scan any installed plugin for prompt injection, malicious hooks, and data exfiltration |
| `plugin-security` | Threat model and heuristics reference — attack taxonomy, severity guide, detection patterns |

Runs automatically via `SessionStart` hook: detects newly installed or updated plugins and prompts Claude to scan before your first request.

### design-patterns

| Skill | Patterns Covered |
|-------|-----------------|
| `pattern-selection` | **Entry point** — decision tree mapping pain to pattern |
| `creational` | Singleton, Builder, Factory Method, Abstract Factory, Prototype |
| `structural` | Adapter, Facade, Decorator, Proxy, Composite, Flyweight, Bridge |
| `behavioural` | Chain of Responsibility, Command, Strategy, State, Observer, Memento, Mediator, Visitor, Iterator, Template Method |
| `domain-modeling` | Entity, Value Object, Aggregate, Aggregate Root |
| `data-access` | Repository, Unit of Work, Data Mapper, Active Record |
| `service-layer` | Application Service, Domain Service, Service Layer |
| `domain-events` | Domain Events, Transactional Outbox, eventual consistency |
| `cqrs` | Commands, Queries, Read Models, Projections |
| `anti-corruption` | Anti-Corruption Layer, Gateway, Strangler Fig |

### llm-patterns

| Skill | Pain It Removes |
|-------|----------------|
| `pattern-selection` | **Entry point** — decision tree for LLM integration patterns |
| `structured-generation` | Output breaks parsers, violates schemas, varies in shape |
| `rag` | LLM hallucinates, lacks domain knowledge, gives stale answers |
| `tool-use` | LLM needs live data, calculations, or side effects |
| `agent-loop` | Task requires autonomous multi-step reasoning |
| `guardrails` | Output contains harmful content, PII, or policy violations |
| `prompt-engineering` | Prompts are ad-hoc, untested, unversioned |
| `graceful-degradation` | Model is down, slow, or over budget |
| `evaluation-harness` | No way to measure quality or detect regressions |
| `tool-synthesis` | LLM called repeatedly for tasks codifiable as deterministic tools |

### harness-engineering

| Skill | Concern |
|-------|---------|
| `memory-compaction` | Hot/warm/cold tiering; lossy compression that preserves load-bearing facts |
| `session-persistence` | Append-only event log, idempotent replay, fork/branch semantics |
| `prompt-caching` | Cache breakpoint placement, TTL, silent-regression traps |
| `subagent-orchestration` | Fork vs fresh, briefing rules, isolation, result merge |
| `tool-sandboxing` | Filesystem jail, egress allowlist, scoped credentials, safety vs security |
| `permission-gates` | Risk classification, scope-bound consent, irreversibility detection |
| `streaming-io` | Partial JSON parsing, mid-stream tool dispatch, cancellation |
| `concurrency-control` | Conflict graphs, intent-order feed, partial-failure semantics |
| `telemetry-tracing` | Span trees, cost attribution, replay from trace |
| `hook-system` | Event taxonomy, blocking vs observation, failure isolation |
| `workspace-state` | Read-before-edit invariant, external-mutation detection |
| `model-routing` | Capability/cost routing, distinct from graceful degradation |
| `rate-limiting` | Token buckets per dimension, fair allocation, 429 with Retry-After |

### meta-webxr-skills

| Skill | Trigger |
|-------|---------|
| `webxr-session` | WebXR session lifecycle, requestSession, feature flags |
| `webxr-rendering` | XR render loop, reference spaces, frame timing |
| `webxr-input` | Controller input, hand tracking, hit testing |
| `webxr-passthrough` | AR/MR passthrough, plane/mesh detection |
| `webxr-anchors` | Persistent spatial anchors |
| `webxr-layers` | WebXR Layers API, compositing |
| `webxr-ratk` | Reality Accelerator Toolkit (Three.js wrapper) |
| `webxr-pwa-quest` | PWA manifest, service worker, Meta Quest packaging |

### threejs-skills

| Skill | Trigger |
|-------|---------|
| `threejs-fundamentals` | Scene setup, cameras, renderer, Object3D hierarchy |
| `threejs-geometry` | Built-in shapes, BufferGeometry, custom geometry, instancing |
| `threejs-materials` | PBR materials, shader materials, material properties |
| `threejs-lighting` | Light types, shadows, environment lighting |
| `threejs-textures` | Texture types, UV mapping, environment maps |
| `threejs-animation` | Keyframe animation, skeletal animation, morph targets |
| `threejs-loaders` | GLTF loading, texture loading, async patterns |
| `threejs-shaders` | GLSL, ShaderMaterial, uniforms, custom effects |
| `threejs-postprocessing` | EffectComposer, bloom, DOF, screen effects |
| `threejs-interaction` | Raycasting, controls, mouse/touch input, object selection |

### freshdesk-api

| Skill | Trigger |
|-------|---------|
| `freshdesk-api` | Freshdesk API: tickets, contacts, companies, knowledge base articles, webhooks, automation |

Five reference files cover the full API surface: tickets, contacts/companies, Solutions (knowledge base), webhooks/automation, and SDK examples.

### doc-review

| Command | Purpose |
|---------|---------|
| `/doc-review:review-doc <file>` | Start in-browser annotation overlay on HTML/MD/TXT; runs auto-apply loop |
| `/doc-review:apply-review [<json>]` | Guided apply of pending review comments back into source |
| `/doc-review:review-doc-stop` | Drop this session's references; servers exit when last ref drops |

Multi-session aware: two sessions reviewing the same doc share one server. Apply button in browser queues edits; Claude applies within ~60s. Stores comments under `<project-root>/.doc-review/`.

## Acknowledgements

- `threejs-skills` originally sourced from [pinkforest/threejs-playground](https://github.com/pinkforest/threejs-playground) (MIT)

