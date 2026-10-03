# AI Security Engineering Portfolio

Hands-on work from the **EnGenious AI Security Engineer: Red Teaming & Agentic AI Defense** cohort, September–October 2026.

This repository documents my progression from AI security assessment and threat modelling into building, testing and verifying attacks against agentic AI systems. It combines my software-quality background with practical work on prompt injection, access control, sensitive-data exposure, excessive agency, RAG risks and security regression testing.

> **Status:** Active course portfolio. Work currently covers Days 1–6. The repository will continue to evolve as the remaining course labs are completed.

## Portfolio highlights

### Assessing an agentic system

- Mapped the MerciBank attack surface across chat, system prompts, RAG, tools, session state and identity boundaries.
- Defined threat hypotheses using OWASP LLM and Agentic AI risks.
- Established rules of engagement, prohibited actions and deterministic success criteria.
- Used planted canaries and response-envelope evidence to distinguish suspected behaviour from proven findings.

### Building an attacker agent

- Built a campaign runner covering prompt injection, access-control failure, sensitive-data exposure, excessive agency and chained attacks.
- Added adaptive mutation through an optional local attacker model.
- Implemented deterministic judges for both response leakage and forbidden tool actions.
- Added retrieval and tool-call evidence to saved findings.
- Tested BOLA boundary crossing, including ordering, correlation and false-positive controls.

### Verifying and promoting findings

Implemented the audit loop:

```text
candidate → reproduce → gate → confirm/reject → promote → regress
```

The verifier:

- Replays candidates from fresh sessions in parallel.
- Applies a configurable reproduction threshold.
- Assesses impact and mitigation context.
- Compares behaviour with a plain, tool-less model to test whether a finding is specifically agentic.
- Promotes confirmed findings into runnable Promptfoo regression cases.
- Evaluates assertions against the complete response envelope so tool actions can be detected even when the conversational reply appears safe.

Generated campaigns and evaluation results remain local and are not committed. The repository contains the implementation and reproducible methodology.

## Repository map

| Path | Purpose |
|---|---|
| [`SYLLABUS.md`](SYLLABUS.md) | Living record of the course structure and topics |
| [`days/`](days/) | Recaps and exercises from Days 1–4 |
| [`session-notes/`](session-notes/) | Detailed notes from the taught sessions |
| [`labs/week2-mercibank/`](labs/week2-mercibank/) | Deliberately vulnerable banking agent used for authorised local testing |
| [`labs/week3-attacker-agent/`](labs/week3-attacker-agent/) | Day 5 attacker campaign and Day 6 verification/promotion workflow |
| [`ai-security-chatbot/`](ai-security-chatbot/) | Larger Week 4 target environment with UI, RAG and ticketing components |
| [`docs/`](docs/) | Portfolio and supporting documentation |

## Testing and evidence principles

The work follows several core assurance principles:

- A single unexpected response is a candidate, not automatically a finding.
- Reproduction begins from clean state so earlier conversation history does not hide or manufacture the trigger.
- Security verdicts are made by deterministic code rather than by the model under test.
- User-supplied canaries must not be mistaken for target-originated leakage.
- A Promptfoo `FAIL` can be the expected result when a regression successfully detects a live vulnerability.
- A passing test is not proof of remediation unless the assertion is known to detect the original failure.
- Findings are reported with bounded claims supported by response text, retrieval traces, flags or tool-call evidence.

## Responsible-use boundary

All offensive testing in this repository is intended exclusively for the deliberately vulnerable local course targets and fictional data supplied for the labs.

The attacker agent must not be pointed at public, third-party or unauthorised systems. See the applicable rules of engagement:

- [MerciBank rules of engagement](labs/week2-mercibank/rules-of-engagement.md)
- [Attacker-agent rules of engagement](labs/week3-attacker-agent/rules-of-engagement.md)

## Toolkit

- Node.js and Python
- Promptfoo
- OpenAI-compatible model APIs
- Local attacker models
- Git and GitHub
- Deterministic canary and tool-action assertions
- OWASP LLM and Agentic AI risk frameworks
- AI-assisted development with human review, testing and evidence validation

## Current focus

The next stage applies the same assessment loop to the larger AI Security Chatbot environment, with particular attention to multi-turn behaviour, RAG trust boundaries, tool use and faithful security-regression replay.

## Related course

This course is an advanced follow-on to [Break Into AI Testing](https://github.com/engenious-inc/Break-Into-AI-Testing).
