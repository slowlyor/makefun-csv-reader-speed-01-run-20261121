// Fast drop-in for csv-reader 1.0.0: run(input) returns exactly {columns, rows, errors}
// for {text, header}, following the competition's written broken-row policy:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it is one quote, each CRLF or lone CR inside it is read as LF;
//     what follows its closing quote, up to the next comma or line break, is
//     appended as it stands (quote_junk, when the field ends); a quote that never
//     closes is a literal character and the text after it is read again as
//     unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the
//     records after it (every record when header is false), each padded with ""
//     (short_row, with fields: its count) or cut (long_row, with extra: the cut
//     fields) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record starts
//     on (every LF, CRLF and lone CR inside a quoted field counted), row its
//     record's index in rows (null for the header), in the order met, a field's
//     quote_junk when the field ends and a record's short_row or long_row when
//     the record ends.
//
// Speed comes from scanning with String.indexOf (native search) instead of
// walking one character at a time: an unquoted field is found by locating the
// nearest of comma, LF and CR, and a quoted field by locating the next quote.
// Pure: no clock, no randomness, no locale, nothing kept from one call to the
// next. Dependency-free ES module, standard library only.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  // The next LF that would end the current record (n when there is none):
  // the record's LF is found once at the record's start and reused by every
  // unquoted field in it, instead of searching for it again per field. It
  // only goes stale when a quoted field swallows an LF as content, and then
  // the next unquoted field re-finds it (recLf < pos detects that).
  let recLf = 0;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, how it ended, and how many characters the
  // unquoted scan appended to it (0 for a clean quoted field).
  let fVal = '';
  let fEnd = END;
  let fAdded = 0;

  // Reads unquoted characters onto `v` up to the next comma or line break: a CR
  // not followed by LF is dropped (stray_cr). Sets fVal/fEnd/fAdded.
  //
  // The field ends at the nearest comma or LF (or the end of the text); only
  // the field's own slice is searched for CRs, so a sparse CR never makes a
  // search run past the field. A CR is the CRLF line break only when it is
  // the slice's last character and the field ends at that LF; every other CR
  // in the slice is a stray_cr.
  function unquoted(v) {
    if (recLf < pos) {
      recLf = text.indexOf('\n', pos);
      if (recLf === -1) recLf = n;
    }
    const ci = text.indexOf(',', pos);
    let end;
    let kind;
    if (ci !== -1 && ci < recLf) {
      end = ci;
      kind = COMMA;
    } else if (recLf < n) {
      end = recLf;
      kind = LINE_BREAK;
    } else {
      end = n;
      kind = END;
    }
    const stop = end;
    const s = text.slice(pos, stop);
    let added = 0;
    if (s.indexOf('\r') === -1) {
      added = s.length;
      if (s.length !== 0) v += s;
    } else {
      const crlf = kind === LINE_BREAK && s.charCodeAt(s.length - 1) === 13;
      const body = crlf ? s.slice(0, -1) : s;
      let out = '';
      let from = 0;
      for (;;) {
        const r = body.indexOf('\r', from);
        if (r === -1) {
          out += body.slice(from);
          break;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        out += body.slice(from, r);
        from = r + 1;
      }
      added = out.length;
      v += out;
    }
    if (kind === COMMA) pos = end + 1;
    else if (kind === LINE_BREAK) {
      pos = end + 1;
      line += 1;
    } else {
      pos = n;
    }
    fVal = v;
    fAdded = added;
    fEnd = kind;
  }

  // The slice text[a..b) of a quoted field, with each CRLF or lone CR inside it
  // read as one LF; counts every line break it holds onto `line`. The slice
  // is taken first and only it is searched, so a sparse CR never makes a
  // search run past the segment.
  function quotedSlice(a, b) {
    if (a >= b) return '';
    const s = text.slice(a, b);
    if (s.indexOf('\n') === -1 && s.indexOf('\r') === -1) return s;
    let t = s;
    if (t.indexOf('\r') !== -1) t = t.replace(/\r\n?/g, '\n');
    let count = 0;
    let at = -1;
    while ((at = t.indexOf('\n', at + 1)) !== -1) count += 1;
    line += count;
    return t;
  }

  // Reads a quoted field whose opening quote is at pos. Sets fVal/fEnd/fAdded.
  function quoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let v = '';
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after
        // it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        unquoted('"');
        return;
      }
      if (q + 1 < n && text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one quote in the value, and the field goes on.
        v += quotedSlice(pos, q);
        v += '"';
        pos = q + 2;
        continue;
      }
      v += quotedSlice(pos, q);
      pos = q + 1;
      break;
    }
    if (pos >= n) {
      fVal = v;
      fAdded = 0;
      fEnd = END;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fVal = v;
      fAdded = 0;
      fEnd = COMMA;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fVal = v;
      fAdded = 0;
      fEnd = LINE_BREAK;
      return;
    }
    if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fVal = v;
      fAdded = 0;
      fEnd = LINE_BREAK;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next
    // comma or line break.
    unquoted(v);
    if (fAdded > 0) {
      errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: when the stretch up to the next LF holds no quote, no field
    // in this record can span that LF, so the stretch is the whole record
    // and its fields are just its comma-separated pieces. A CR counts only
    // as the trailing CRLF character; any other CR falls back to the
    // field-by-field path below, which reports stray_cr. The checks search
    // from pos and stop at the first hit, so they never run past the record.
    let fields;
    let isQuoted = false;
    const lf = text.indexOf('\n', pos);
    const segEnd = lf === -1 ? n : lf;
    recLf = segEnd;
    const q = text.indexOf('"', pos);
    if (q === -1 || q >= segEnd) {
      const r = text.indexOf('\r', pos);
      const crlf = lf !== -1 && r === segEnd - 1;
      if (r === -1 || r >= segEnd || crlf) {
        fields = text.slice(pos, crlf ? segEnd - 1 : segEnd).split(',');
        if (lf === -1) pos = n;
        else {
          pos = lf + 1;
          line += 1;
        }
      }
    }
    if (fields === undefined) {
      fields = [];
      do {
        isQuoted = text.charCodeAt(pos) === 34;
        if (isQuoted) quoted();
        else unquoted('');
        fields.push(fVal);
      } while (fEnd === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !isQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
