// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code, the feature names, and the four documentation pages, which keep the
// same sections. German says "du", never the polite "Sie"; Spanish says
// "usted".
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { NAMES, STATUS_LABELS, TEXT } from '../src/i18n.js';
import { STATUS_KEYS, UNKNOWN_STATUS } from '../src/solax/models.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)(?!\p{L})/u;
// The familiar Spanish forms the docs and messages must not use.
const FAMILIAR_SPANISH = /(?<!\p{L})(tú|tu|tus|puedes|tienes|elige|introduce)(?!\p{L})/iu;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  message: 200,
  short: 40,
  featureName: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  if (lang === 'es' && FAMILIAR_SPANISH.test(text)) {
    found.push(`${path} uses the familiar form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

// Tables written one language at a time: same keys everywhere, no empty text.
function tableProblems(table, name, max, render = (value) => value) {
  const found = [];
  if (JSON.stringify(sorted(Object.keys(table))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${name} has [${Object.keys(table)}], expected exactly [${LANGS}]`);
  }
  for (const lang of LANGS) {
    const entries = table[lang] ?? {};
    if (
      JSON.stringify(sorted(Object.keys(entries))) !== JSON.stringify(sorted(Object.keys(table.en)))
    ) {
      found.push(`${name}.${lang} does not have the keys of ${name}.en`);
    }
    for (const [key, value] of Object.entries(entries)) {
      found.push(...textProblems(render(value), `${name}.${lang}.${key}`, lang, max));
    }
  }
  return found;
}

test('the configuration offers the four languages, French by default', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  assert.equal(manifest.config_schema.find((f) => f.key === 'language').default, 'fr');
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 80, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the name is the same in every language, 3 to 30 characters', () => {
  assert.equal(typeof manifest.name, 'string');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  for (const lang of LANGS) {
    assert.ok(manifest.description[lang].length >= 10, `description.${lang} is too short`);
  }
});

test('the feature names exist in every language', () => {
  const render = (value) => (typeof value === 'function' ? value(3) : value);
  assert.deepEqual(tableProblems(NAMES, 'NAMES', MAX.featureName, render), []);
});

test('the inverter states exist in every language', () => {
  assert.deepEqual(
    sorted(Object.keys(STATUS_LABELS.en)),
    sorted([...STATUS_KEYS, UNKNOWN_STATUS, 'offline']),
  );
  assert.deepEqual(tableProblems(STATUS_LABELS, 'STATUS_LABELS', 40), []);
});

test('every message of the code has the four languages', () => {
  const sample = { pv: '1.2 kW', today: '5 kWh', grid: 'exporting 300 W', battery: '80 %' };
  const found = Object.entries(TEXT).flatMap(([key, value]) => {
    const rendered =
      typeof value.en === 'function'
        ? Object.fromEntries(Object.entries(value).map(([lang, fn]) => [lang, fn(sample)]))
        : value;
    return problems(rendered, `TEXT.${key}`, MAX.message);
  });
  assert.deepEqual(found, []);
});

// --- Documentation ------------------------------------------------------------

const docs = Object.fromEntries(
  await Promise.all(
    LANGS.map(async (lang) => [
      lang,
      await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8'),
    ]),
  ),
);
const headings = (text) =>
  text
    .split('\n')
    .filter((line) => /^#{1,3} /.test(line))
    .map((line) => line.match(/^#+/)[0].length);

test('the four documentation pages have the same sections', () => {
  const reference = headings(docs.en);
  assert.ok(reference.filter((level) => level === 2).length >= 8, 'docs/en.md has few sections');
  for (const lang of LANGS) {
    assert.deepEqual(headings(docs[lang]), reference, `docs/${lang}.md sections differ from en`);
    assert.ok(docs[lang].length >= 300, `docs/${lang}.md is too short for the store`);
  }
});

test('the documentation says it was developed without the hardware, in every language', () => {
  assert.match(docs.en, /Developed without the hardware: feedback welcome/);
  assert.match(docs.fr, /Développée sans le matériel/);
  assert.match(docs.de, /Ohne die Hardware entwickelt/);
  assert.match(docs.es, /Desarrollada sin el hardware/);
  for (const lang of LANGS) {
    assert.match(docs[lang], /not affiliated with SolaX Power|SolaX Power/);
  }
});

test('German documentation uses "du", Spanish "usted"', () => {
  const prose = (text) => text.replace(/`[^`]*`/g, '');
  assert.ok(!POLITE_GERMAN.test(prose(docs.de)), 'docs/de.md uses the polite form');
  assert.ok(!FAMILIAR_SPANISH.test(prose(docs.es)), 'docs/es.md uses the familiar form');
});

test('the guard catches a missing language, an empty text and the polite German form', () => {
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: 'Licht' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: '', es: 'Luz' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of ['Wählen Sie', 'Ihr Gerät', 'Ihre IP', 'mit Ihrem', 'Ihnen']) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'Elige tu inversor' }, 'x', 60).length, 1);
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  const forgotten = structuredClone(manifest);
  delete forgotten.scene_actions[0].fields[0].label.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.scene_actions[0].fields[0].label has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});
