---
id: issue-codes
title: Issue codes
sidebar_label: Issue codes
description: "Every issue code @cosyte/transform can return, with its severity, its FHIR issue type and its fixed message, and the reserved fatal codes."
---

# Issue codes

Every diagnostic `@cosyte/transform` returns is a `TransformIssue` with one of the codes below. The
severity, the FHIR `OperationOutcome.issue.code` (the R4 `issue-type` value) and the message are
fixed per code in `ISSUE_REGISTRY`; the only things that vary are the v2 location and the FHIR
path, and neither carries a value from the message. The table is checked against the registry by
the test suite. The [reference](./api/README.md#issue_codes) documents `ISSUE_CODES`,
[`ISSUE_REGISTRY`](./api/README.md#issue_registry) and
[`TransformIssue`](./api/README.md#transformissue).

A code's name is part of the public contract: renaming or removing one is a breaking change, and
new codes are additions only.

## Issue codes

| Code | Severity | FHIR issue type | Message |
| --- | --- | --- | --- |
| `TRANSFORM_TIMESTAMP_NO_TIMEZONE` | `warning` | `value` | v2 timestamp carried a time-of-day but no timezone offset; reduced to date precision (FHIR forbids time without a zone). |
| `TRANSFORM_TIMESTAMP_INVALID` | `warning` | `value` | v2 timestamp could not be parsed into a valid FHIR date/time; no value emitted. |
| `TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED` | `warning` | `not-found` | assigning authority could not be resolved to an Identifier.system; identifier emitted with value and no system (never synthesized from a bare namespace). |
| `TRANSFORM_CODE_UNMAPPED` | `warning` | `code-invalid` | coded value could not be mapped to a FHIR concept (no coding system, or no target in the IG ConceptMap); original code preserved / FHIR value left absent, never coerced or guessed. |
| `TRANSFORM_CODE_SYSTEM_UNRESOLVED` | `warning` | `code-invalid` | coding-system mnemonic not recognized; code preserved, no system URI invented. |
| `TRANSFORM_UNIT_NOT_UCUM` | `warning` | `value` | unit is not a valid UCUM code; preserved verbatim in Quantity.unit, code/system absent, magnitude never converted. |
| `TRANSFORM_QUANTITY_VALUE_INVALID` | `warning` | `value` | numeric value is not a valid FHIR decimal literal (e.g. leading sign/zero or trailing dot); no Quantity value emitted rather than altering the magnitude. |
| `TRANSFORM_ELEMENT_DROPPED` | `information` | `informational` | populated source element was not carried to its FHIR target (no target in this map, or its conversion is not implemented); dropped. |
| `TRANSFORM_NAME_USE_UNMAPPED` | `information` | `value` | name-type code has no equivalent in the HL70200 to name-use map; use left absent. |
| `TRANSFORM_ADDRESS_USE_UNMAPPED` | `information` | `value` | address-type code has no equivalent in the HL70190 to address-use/type maps; use/type left absent. |
| `TRANSFORM_SEGMENT_ASSEMBLED` | `information` | `informational` | message trigger has no IG message map; resource graph assembled from IG segment maps, best-effort. |
| `TRANSFORM_RESOURCE_INVALID` | `error` | `structure` | produced resource failed FHIR R4 structural validation; withheld from the bundle rather than emitted invalid. |
| `TRANSFORM_REQUIRED_ELEMENT_UNKNOWN` | `information` | `informational` | required FHIR element could not be derived from the source; emitted with a data-absent-reason extension, never fabricated. |
| `TRANSFORM_MISSING_TRIGGER` | `error` | `required` | reverse conversion requires an explicit v2 trigger from the caller; no resource carries one, so none was inferred and no message was built. |
| `TRANSFORM_UNSUPPORTED_RESOURCE` | `error` | `not-supported` | resource type is outside the reverse converter's supported shapes; no v2 message emitted and no segment layout guessed. |
| `TRANSFORM_RESOURCE_MALFORMED` | `error` | `structure` | input is not a structurally well-shaped FHIR resource for this conversion; nothing emitted, nothing thrown. |
| `TRANSFORM_NO_V2_TARGET` | `information` | `informational` | populated FHIR element has no v2 field in this reverse map; surfaced and left out, never approximated into a neighbouring field. |
| `TRANSFORM_VALUE_NOT_REPRESENTABLE` | `warning` | `value` | FHIR value cannot be carried into its v2 target without altering it; the v2 field is left absent, never truncated, rounded, or coerced. |
| `TRANSFORM_CODE_NOT_INVERTIBLE` | `warning` | `code-invalid` | FHIR code has no usable inverse in the governing IG ConceptMap (ambiguous or absent); v2 field left absent, never resolved arbitrarily. |
| `TRANSFORM_CODE_SYSTEM_NOT_V2` | `warning` | `code-invalid` | coding system has no v2 coding-system mnemonic here; coding flagged rather than written with no table context or from an unrelated table. |
| `TRANSFORM_V2_REQUIRED_FIELD_ABSENT` | `error` | `required` | a v2-required field is absent from the emitted segment because the resource carried no source this map could ground it from; left absent per v2 optionality rules and declared here, never filled with a placeholder. |
| `TRANSFORM_NO_V2_MESSAGE_EMITTED` | `error` | `processing` | no v2 message was emitted: nothing in the resource grounded a single field of the target segment, and an empty segment is never emitted. |
| `TRANSFORM_SEGMENT_NOT_EMITTED` | `information` | `informational` | segment occurrence reached no resource in the returned bundle, and the IG publishes a segment map for its name; the bundle does not represent what this segment carried. |
| `TRANSFORM_SEGMENT_NO_IG_MAP` | `information` | `informational` | segment occurrence reached no resource in the returned bundle, and the IG publishes no segment map for its name, or the name could not be classified at all; the bundle does not represent what this segment carried. |
| `TRANSFORM_TIMESTAMP_DROPPED_BY_PARSER` | `warning` | `value` | v2 date/time field is valued, but the parser's typed view could not read it and handed back no timestamp; no value emitted. |

## Which calls raise which codes

- **The datatype converters**, and the message assembly that uses them:
  `TRANSFORM_TIMESTAMP_NO_TIMEZONE`, `TRANSFORM_TIMESTAMP_INVALID`,
  `TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED`, `TRANSFORM_CODE_UNMAPPED`,
  `TRANSFORM_CODE_SYSTEM_UNRESOLVED`, `TRANSFORM_UNIT_NOT_UCUM`, `TRANSFORM_QUANTITY_VALUE_INVALID`,
  `TRANSFORM_NAME_USE_UNMAPPED`, `TRANSFORM_ADDRESS_USE_UNMAPPED` and `TRANSFORM_ELEMENT_DROPPED`.
- **`toFhir` alone**: `TRANSFORM_SEGMENT_ASSEMBLED`, `TRANSFORM_RESOURCE_INVALID`,
  `TRANSFORM_REQUIRED_ELEMENT_UNKNOWN`, `TRANSFORM_TIMESTAMP_DROPPED_BY_PARSER`,
  `TRANSFORM_SEGMENT_NOT_EMITTED` and `TRANSFORM_SEGMENT_NO_IG_MAP`.
- **`toFhirCodeableConceptVia`**: `TRANSFORM_CODE_UNMAPPED` and `TRANSFORM_CODE_SYSTEM_UNRESOLVED`.
- **The reverse path**, `toV2Patient` and `toV2Observation`: `TRANSFORM_MISSING_TRIGGER`,
  `TRANSFORM_UNSUPPORTED_RESOURCE`, `TRANSFORM_RESOURCE_MALFORMED`, `TRANSFORM_NO_V2_TARGET`,
  `TRANSFORM_VALUE_NOT_REPRESENTABLE`, `TRANSFORM_CODE_NOT_INVERTIBLE`,
  `TRANSFORM_CODE_SYSTEM_NOT_V2`, `TRANSFORM_V2_REQUIRED_FIELD_ABSENT` and
  `TRANSFORM_NO_V2_MESSAGE_EMITTED`.

## Fatal codes

`FATAL_CODES` names the conditions a future entry point may throw for. Nothing in the library
throws one today: every path returns an issue instead. They are declared so that a future one is an
addition rather than a rename.

| Code | Meaning |
| --- | --- |
| `EMPTY_INPUT` | The input carried nothing to transform. |
| `TRANSFORM_UNSUPPORTED_INPUT` | The input was not a shape this transform accepts. |

## See also

- [Read, log and return the issues](./handle-issues.md): branch on a code and render an
  `OperationOutcome`.
- [Troubleshooting](./troubleshooting.md): what to do about the common ones.
