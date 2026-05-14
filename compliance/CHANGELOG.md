# Compliance suite changelog

All notable changes to the `@postel/compliance` test corpus and runner are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The suite ships **lockstep** with the rest of the `@postel/*` release train per [`openspec/specs/compliance/spec.md`](../openspec/specs/compliance/spec.md): `@postel/compliance@X.Y.Z` is the test corpus every `@postel/*` port at version `X.Y.Z` MUST pass. Pre-1.0 we live under the `0.x` experimental-semantics regime ([VISION.md §8](../VISION.md)); behavior-changing MINORs are allowed and ports adapt alongside the bump.

## Entry shape

Every test addition, modification, or removal lands here. Each entry cites:

- The OpenSpec change that motivated it (`change/<name>`).
- The capability + `### Requirement: <title>` it covers.
- The release version (`X.Y.Z`) the change ships in.
- For modifications and removals: whether the change is breaking (gates on MAJOR).

## [Unreleased]

<!--
Entries land here as tests are authored. v0.1.0 will cut from this section
once the scope enumerated in openspec/specs/compliance/spec.md is implemented.
-->
