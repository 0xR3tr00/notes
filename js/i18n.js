/* =============================================================================
   Notes++ — i18n.js
   -----------------------------------------------------------------------------
   Interface translation. Loaded before main.js so t() exists by the time any
   page renders.

   How it works
   ------------
   1. data/ui.json holds every visible string, keyed, once per language.
   2. Static HTML marks translatable bits with data-i18n attributes:
        <h2 data-i18n="courses.title">Courses</h2>
        <input data-i18n-placeholder="common.search">
        <nav data-i18n-aria-label="nav.main">
      The English in the HTML is a fallback: if JS never runs, the page still
      reads correctly. applyTranslations() overwrites it once strings load.
   3. Dynamic HTML (main.js / curriculum.js templates) calls t('key') directly.
   4. Switching language sets <html lang dir>, saves the choice, and re-renders
      the page — the CSS does the rest via :lang(ar) and [dir="rtl"].

   Numbers stay Western (1, 2, 3) in both languages: course codes like CS201 and
   credit counts are read as Latin numerals by students here, and mixing digit
   systems inside one line is worse than leaving them.
   ============================================================================= */
'use strict';

const UI_URL = 'data/ui.json';
const LANG_KEY = 'lang';

let LANGS = [{ code: 'en', label: 'English', dir: 'ltr', short: 'EN' }];
let STRINGS = {};          // { en: {...}, ar: {...} }
let LANG = 'en';

/** The language actually in use, falling back to English if the saved one is gone. */
function currentLang(){
  return STRINGS[LANG] ? LANG : 'en';
}

/** Metadata (dir, label…) for a language code. */
function langInfo(code = currentLang()){
  return LANGS.find(l => l.code === code) || LANGS[0];
}

/**
 * Translate a key. `vars` fills {placeholders}.
 *   t('courses.countOf', { n: 3, total: 38 })
 * Missing keys fall back to English, then to the key itself — so a half-finished
 * translation degrades to English instead of showing blanks.
 */
function t(key, vars){
  const table = STRINGS[currentLang()] || {};
  // Minimal plural support: if vars.n is 1 and the CURRENT language defines a
  // "<key>_one" string, use it. English needs it ("1 note" vs "3 notes");
  // Arabic reads fine with one form, so ar omits the _one variants — and the
  // check is deliberately against `table`, not the English fallback, so a
  // missing Arabic plural never drags in the English sentence.
  const lookup = k => (table[k] !== undefined ? table[k] : (STRINGS.en || {})[k]);
  const singular = vars && Number(vars.n) === 1 && table[key + '_one'] !== undefined;
  let str = singular ? table[key + '_one'] : lookup(key);
  if(str === undefined) return key;
  if(vars){
    for(const [k, v] of Object.entries(vars)){
      str = str.replaceAll(`{${k}}`, v);
    }
  }
  return str;
}

/** Apply every data-i18n* attribute inside `root` (default: the document). */
function applyTranslations(root = document){
  root.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  // Attributes: data-i18n-placeholder -> placeholder, data-i18n-aria-label -> aria-label…
  root.querySelectorAll('*').forEach(el => {
    for(const name of Object.keys(el.dataset)){
      if(!name.startsWith('i18n') || name === 'i18n') continue;
      // i18nAriaLabel -> aria-label ; i18nPlaceholder -> placeholder
      const attr = name.slice(4).replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
      el.setAttribute(attr, t(el.dataset[name]));
    }
  });
  if(root === document) document.title = pageTitle();
}

/** <title> per page, built from the page's own key plus the site name. */
function pageTitle(){
  const key = document.body.dataset.titleKey;
  const name = 'Notes++';
  return key ? `${t(key)} — ${name}` : name;
}

/** Switch language: persist, set lang/dir, retranslate, re-render the page. */
function setLang(code){
  LANG = STRINGS[code] ? code : 'en';
  try{ localStorage.setItem(LANG_KEY, LANG); }catch(_){}
  const info = langInfo();
  document.documentElement.lang = info.code;
  document.documentElement.dir = info.dir;
  applyTranslations();
  updateLangButton();
  // Let the page redraw anything it built from templates.
  document.dispatchEvent(new CustomEvent('langchange', { detail: { lang: LANG } }));
}

function updateLangButton(){
  const btn = document.querySelector('.lang-toggle');
  if(!btn) return;
  // The button shows the language you would switch TO.
  const next = LANGS.find(l => l.code !== currentLang()) || LANGS[0];
  btn.querySelector('.label').textContent = next.short;
  btn.setAttribute('aria-label', `${t('lang.switch')}: ${next.label}`);
  btn.setAttribute('lang', next.code);
}

/* Pages that load both main.js and curriculum.js would otherwise initialise
   twice; the promise is cached so the second caller just awaits the first. */
let i18nReady = null;

/** Load ui.json and apply the saved language. Safe to call more than once. */
function initI18n(){
  return i18nReady || (i18nReady = doInitI18n());
}

async function doInitI18n(){
  try{
    const res = await fetch(UI_URL);
    if(res.ok){
      const data = await res.json();
      LANGS = data._languages || LANGS;
      STRINGS = Object.fromEntries(
        Object.entries(data).filter(([k]) => !k.startsWith('_'))
      );
    }
  }catch(err){
    console.error('i18n: could not load', UI_URL, err);   // English fallback still works
  }
  let saved = null;
  try{ saved = localStorage.getItem(LANG_KEY); }catch(_){}
  LANG = STRINGS[saved] ? saved : 'en';

  const info = langInfo();
  document.documentElement.lang = info.code;
  document.documentElement.dir = info.dir;
  applyTranslations();

  const btn = document.querySelector('.lang-toggle');
  if(btn){
    btn.addEventListener('click', () => {
      const next = LANGS.find(l => l.code !== currentLang()) || LANGS[0];
      setLang(next.code);
    });
    updateLangButton();
  }
}
