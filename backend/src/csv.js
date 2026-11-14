const DANGEROUS_PREFIX = /^[=+\-@\t\r]/;

function escapeField(value) {
  let text = value === null || value === undefined ? '' : String(value);

  if (DANGEROUS_PREFIX.test(text)) {
    text = `'${text}`;
  }

  if (/[",\n\r]/.test(text)) {
    text = `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export function toCsv(columns, rows) {
  const header = columns.map(escapeField).join(',');
  const lines = rows.map(row => columns.map(col => escapeField(row[col])).join(','));
  return '﻿' + [header, ...lines].join('\r\n') + '\r\n';
}
