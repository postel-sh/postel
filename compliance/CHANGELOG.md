# Compliance suite changelog

All notable changes to the `@postel/compliance` test corpus and runner are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the suite follows [SemVer](https://semver.org/) under the runway-based evolution policy defined in [`openspec/specs/compliance/spec.md`](../openspec/specs/compliance/spec.md) and motivated by [ADR 0009](../decisions/0009-compliance-suite-evolution.md).

## Entry shape

Every test addition, lifecycle transition (ADVISORY → MANDATORY → DEPRECATED → removed), modification, and removal lands here. Each entry cites:

- The OpenSpec change that motivated it (`change/<name>`).
- The capability + `### Requirement: <title>` it covers.
- The current lifecycle stage and the version that stage took effect.
- The runway timeline (introduced date, MANDATORY date, deprecated date, removal date — whichever apply).

Pre-1.0 we live under the `0.x` experimental-semantics regime ([VISION.md §8](../VISION.md)); ports MUST pin against a specific MINOR (`@postel/compliance@~0.1.0`).

## [Unreleased]

<!--
Entries land here as tests are authored. v0.1.0 will cut from this section
once the scope enumerated in openspec/specs/compliance/spec.md is implemented.
-->
