// Fast drop-in for csv-reader 1.0.0: run(input) returns exactly csv-reader's
// reading of {text, header} as {columns, rows, errors}.
//
// The reference reads one character at a time and builds every field up a
// character at a time. This implementation reads the same text once, left to
// right, with the same broken-row policy, but in whole slices: a field that
// holds no quote is taken as one slice up to its next comma or line break,
// and a quoted field as slices up to its next quote or line break. Nothing
// here is copied from the reference; the policy below is re-derived from the
// task's rules and checked against the reference on the practice set.
//
// Policy (one pass, left to right; commas and double quotes):
// - a U+FEFF at the very start is dropped;
// - a record ends at LF or CRLF; a line left with no characters is no record;
// - outside quotes a CR not followed by LF is dropped (stray_cr);
// - a field opening with a quote runs to the next quote that is not doubled,
//   "" inside it is one quote, each CRLF or lone CR inside it is read as LF;
//   what follows its closing quote up to the next comma or line break is
//   appended as it stands (quote_junk, when the field ends); a quote that
//   never closes is a literal character and the text after it is read again
//   as unquoted (unterminated_quote);
// - a quote inside an unquoted field is a literal character;
// - fields stay strings, never trimmed or converted;
// - columns is the first record when header is true, else null; rows holds
//   the records after it (every record when header is false), each padded
//   with empty strings (short_row, with fields: its field count) or cut
//   (long_row, with extra: the cut fields) to the first record's width;
// - each error is {code, line, row}, in the order met; line is the 1-based
//   line its record starts on, counting every LF, CRLF and lone CR inside
//   quotes; row is its record's index in rows, null for the header.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

// The next comma, CR or LF; the next quote, CR or LF. One exec finds the
// nearest of the set, so the slice before the match holds none of them.
const FIELD_END = /[,\r\n]/g;
const FIELD_Q = /["\r\n]/g;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // Finishes a record's fields: a line left with no characters is no record,
  // the first record sets the width (and is the header when header is true),
  // later records are padded or cut to it.
  function endRecord(fields, quoted) {
    if (fields.length === 1 && fields[0] === '' && !quoted) return;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  // Reads unquoted characters onto `value` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr). Returns the field
  // and how it ended; `added` counts the characters kept. One regex exec
  // finds the nearest of comma, CR and LF, so the slice before it holds no
  // CR at all: a CR only ever shows up as the match itself.
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      FIELD_END.lastIndex = pos;
      const m = FIELD_END.exec(text);
      if (m === null) {
        if (pos < len) {
          const seg = text.slice(pos);
          value = value === '' ? seg : value + seg;
          added += seg.length;
          pos = len;
        }
        return { value, ended: END, added };
      }
      const i = m.index;
      if (i > pos) {
        const seg = text.slice(pos, i);
        value = value === '' ? seg : value + seg;
        added += seg.length;
      }
      const c = text.charCodeAt(i);
      if (c === 44) {
        pos = i + 1;
        return { value, ended: COMMA, added };
      }
      if (c === 10) {
        pos = i + 1;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      if (text.charCodeAt(i + 1) === 10) {
        pos = i + 2;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos = i + 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos. One regex exec
  // finds the nearest of quote, CR and LF, so the slice before it holds
  // none of them: each CR or LF inside the quotes becomes one LF.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let closed = false;
    while (pos < len) {
      FIELD_Q.lastIndex = pos;
      const m = FIELD_Q.exec(text);
      if (m === null) {
        if (pos < len) {
          const seg = text.slice(pos);
          value = value === '' ? seg : value + seg;
          pos = len;
        }
        break;
      }
      const i = m.index;
      if (i > pos) {
        const seg = text.slice(pos, i);
        value = value === '' ? seg : value + seg;
      }
      const c = text.charCodeAt(i);
      if (c === 34) {
        if (text.charCodeAt(i + 1) === 34) {
          value += '"';
          pos = i + 2;
          continue;
        }
        pos = i + 1;
        closed = true;
        break;
      }
      value += '\n';
      line += 1;
      pos = c === 13 && text.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after
      // it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    if (pos >= len) return { value, ended: END };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, ended: COMMA };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      if (text.charCodeAt(pos) === 10) {
        pos += 1;
        line += 1;
      } else if (text.charCodeAt(pos) === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // A record whose line holds no quote is read whole: one slice, split on
    // commas, with stray CRs (never the CRLF that ends the line) dropped.
    const iN = text.indexOf('\n', pos);
    const lineEnd = iN === -1 ? len : iN;
    const iQ = text.indexOf('"', pos);
    if (iQ === -1 || iQ >= lineEnd) {
      let lineText = text.slice(pos, lineEnd);
      if (iN !== -1 && lineText.charCodeAt(lineText.length - 1) === 13) lineText = lineText.slice(0, -1);
      let fields;
      if (lineText.indexOf('\r') !== -1) {
        let count = 0;
        for (let j = lineText.indexOf('\r'); j !== -1; j = lineText.indexOf('\r', j + 1)) count++;
        for (let k = 0; k < count; k++) errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        fields = lineText.split('\r').join('').split(',');
      } else {
        fields = lineText.split(',');
      }
      pos = iN === -1 ? len : iN + 1;
      if (iN !== -1) line += 1;
      endRecord(fields, false);
      continue;
    }

    const fields = [];
    let field;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);
    endRecord(fields, quoted);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
