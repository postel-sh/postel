## 1. Spec

- [x] 1.1 Modify `v0.2.0 sender-side initial test scope`: drop the two code-side `filtering-transformation` rows; rewrite the deferral note to cover transform / fail-closed.
- [x] 1.2 Modify `Out-of-scope behaviors at the current MINOR`: extend the `filtering-transformation` line to name transform-produces-body and fail-closed as code-side host-callback behaviors.

## 2. Corpus

- [x] 2.1 Replace the `sender/filtering/transform-reshapes-body` vector with `sender/filtering/channel-filter-no-match` (drivable negative-case channel filter).
- [x] 2.2 Confirm the filtering vectors' `requirement.title` union equals the contract-set table's `filtering-transformation` rows ({Type filter with glob support, Channel filter}).

## 3. Reference port

- [ ] 3.1 Convert the `Filter and transform errors fail closed` TS test from a placeholder to a real assertion (throwing transform → failed attempt, no infinite retry).

## 4. Changelog

- [ ] 4.1 Update `compliance/CHANGELOG.md`: enumeration note reflects the channel-no-match swap; out-of-scope section names transform / fail-closed as code-side.

## 5. Validate + archive

- [ ] 5.1 `openspec validate defer-sender-codeside-filtering-vectors --strict`
- [ ] 5.2 `openspec archive defer-sender-codeside-filtering-vectors -y`
- [ ] 5.3 `mise run check:all`
