---
id: supply-a-sender-timezone
title: Keep the time on a timestamp with no offset
sidebar_label: Supply a sender's timezone
description: "Assert the sending system's UTC offset so a v2 timestamp without one keeps its time of day, instead of being cut to its date."
---

# Keep the time on a timestamp with no offset

Many senders write timestamps with no UTC offset: `20260721143000`. FHIR does not allow a time of day
without a zone, and assuming UTC would move the moment by hours, so by default the library keeps
the date only and raises `TRANSFORM_TIMESTAMP_NO_TIMEZONE`. If you know the sender's offset, assert
it and the time is kept.

## See the default

```ts runnable
import { parseDtm } from "@cosyte/hl7";
import { toFhirDateTime } from "@cosyte/transform";

const { value, issues } = toFhirDateTime(parseDtm("20260721143000"));

value; // => "2026-07-21"
issues.map((i) => i.code); // => ["TRANSFORM_TIMESTAMP_NO_TIMEZONE"]
```

## Assert the offset

Pass `assumeTimezoneOffsetMinutes`, in minutes east of UTC: `-300` is five hours behind, US Eastern
standard time. The time is written with that offset. The issue is still raised, because the offset
came from you and not from the message, and a reader of the issues can see that.

```ts runnable
import { parseDtm } from "@cosyte/hl7";
import { toFhirDateTime } from "@cosyte/transform";

const { value, issues } = toFhirDateTime(parseDtm("20260721143000"), {
  assumeTimezoneOffsetMinutes: -300,
});

value; // => "2026-07-21T14:30:00-05:00"
issues.map((i) => i.code); // => ["TRANSFORM_TIMESTAMP_NO_TIMEZONE"]
```

An offset the message carries is used as it is, and the one you assert is not applied to it:

```ts runnable
import { parseDtm } from "@cosyte/hl7";
import { toFhirDateTime } from "@cosyte/transform";

const { value, issues } = toFhirDateTime(parseDtm("20260721143000-0700"), {
  assumeTimezoneOffsetMinutes: -300,
});

value; // => "2026-07-21T14:30:00-07:00"
issues; // => []
```

## Assert it for a whole message

`toFhir` takes the same option and passes it to the timestamp conversions it runs. Here it keeps
the time of MSH-7, the bundle's timestamp:

```ts runnable
import { parseHL7 } from "@cosyte/hl7";
import { serializeResource } from "@cosyte/fhir";
import { toFhir } from "@cosyte/transform";

const raw = [
  "MSH|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000||ADT^A01^ADT_A01|MSG00003|P|2.5.1",
  "PID|1||MRN12345^^^HOSP^MR||Public^Jane||19800115|F",
  "PV1|1|I",
].join("\r");

const { bundle, issues } = toFhir(parseHL7(raw), { assumeTimezoneOffsetMinutes: -300 });
const json = JSON.parse(serializeResource(bundle)) as { timestamp: string };

json.timestamp; // => "2026-07-21T14:30:00-05:00"
issues.filter((i) => i.code === "TRANSFORM_TIMESTAMP_NO_TIMEZONE").length; // => 1
```

## Use an offset FHIR can write

The offset must be a whole number of minutes from `-840` to `840` (`-14:00` to `+14:00`), the range
FHIR can write. Any other value is ignored: the timestamp is cut to its date, as if you had passed
nothing.

```ts runnable
import { parseDtm } from "@cosyte/hl7";
import { toFhirDateTime } from "@cosyte/transform";

toFhirDateTime(parseDtm("20260721143000"), { assumeTimezoneOffsetMinutes: 900 }).value; // => "2026-07-21"
toFhirDateTime(parseDtm("20260721143000"), { assumeTimezoneOffsetMinutes: 330 }).value; // => "2026-07-21T14:30:00+05:30"
```

Assert an offset only when you know it. A sender in a place that changes its clocks for daylight
saving uses two offsets a year, and one fixed number is wrong for half of them; the safe choice is
to ask the sender to send the offset.

## Reference

- [`toFhirDateTime`](./api/README.md#tofhirdatetime) and
  [`TransformOptions`](./api/README.md#transformoptions)
- [`toFhir`](./api/README.md#tofhir)
- [Issue codes](./issue-codes.md): `TRANSFORM_TIMESTAMP_NO_TIMEZONE`
- [Troubleshooting: my timestamp lost its time of day](./troubleshooting.md#my-timestamp-lost-its-time-of-day)
