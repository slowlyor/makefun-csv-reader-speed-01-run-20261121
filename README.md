[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/slowlyor/makefun-csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/slowlyor/makefun-csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)

# csv-reader-speed-01-run-20261121

A faster drop-in for make.fun's own csv-reader 1.0.0: `solve.js` answers every
case exactly as csv-reader does — same `{columns, rows, errors}`, same broken-row
policy (BOM drop, LF/CRLF, stray CR, quoted fields, doubled quotes, quote junk,
unterminated quotes, short/long row padding and cutting) — but scans with native
`String.indexOf` instead of walking one character at a time.

`main.ts` is the driver the harness runs: it reads every case from
`/input/cases.json`, answers each with `run`, and writes `/output/answers.json`.

Entry for the [csv-reader-speed-01-run-20261121](https://make.fun/competitions/csv-reader-speed-01-run-20261121) competition on make.fun.
