// Builds the candidate codes for a category name, best first.
//
// The convention is mnemonic and letters only, which is what a code people read out loud wants: 4
// letters from the first significant word, 3 from the second, capitals, no digits and no separator.
// Because there are no digits, a clash is resolved by taking one more letter from the name rather
// than by numbering, so the code stays a word someone can recognise.

const MAX_LENGTH = 12;

// Skipped so "Home & Kitchen" gives HOMEKIT rather than HOMEAND.
const SKIP_WORDS = new Set(['and', 'or', 'the', 'of', 'for', 'with', 'a', 'an']);

// Bengali is transliterated before anything else, because a Bengali name has no Latin letters to
// truncate and the client names categories in both languages. Matras and the independent vowels
// map to the same letters; hasant joins two consonants and contributes nothing itself.
const BENGALI = {
      'অ': 'a', 'আ': 'a', 'ই': 'i', 'ঈ': 'i', 'উ': 'u', 'ঊ': 'u', 'ঋ': 'ri',
      'এ': 'e', 'ঐ': 'oi', 'ও': 'o', 'ঔ': 'ou',
      'ক': 'k', 'খ': 'kh', 'গ': 'g', 'ঘ': 'gh', 'ঙ': 'ng',
      'চ': 'ch', 'ছ': 'chh', 'জ': 'j', 'ঝ': 'jh', 'ঞ': 'n',
      'ট': 't', 'ঠ': 'th', 'ড': 'd', 'ঢ': 'dh', 'ণ': 'n',
      'ত': 't', 'থ': 'th', 'দ': 'd', 'ধ': 'dh', 'ন': 'n',
      'প': 'p', 'ফ': 'ph', 'ব': 'b', 'ভ': 'bh', 'ম': 'm',
      'য': 'j', 'র': 'r', 'ল': 'l', 'শ': 'sh', 'ষ': 'sh', 'স': 's', 'হ': 'h',
      '\u09DC': 'r', '\u09DD': 'rh', '\u09DF': 'y', 'ৎ': 't', 'ং': 'ng', 'ঃ': 'h', 'ঁ': '',
      'া': 'a', 'ি': 'i', 'ী': 'i', 'ু': 'u', 'ূ': 'u', 'ৃ': 'ri',
      'ে': 'e', 'ৈ': 'oi', 'ো': 'o', 'ৌ': 'ou', '্': '',
};

// A nukta letter has two spellings in Unicode and NFC does not join them, because these three are
// composition exclusions. Written from a Bengali keyboard they usually arrive as the base letter
// plus U+09BC, which would otherwise read as the base letter alone and turn শাড়ি into SHADI.
const NUKTA = [[/\u09A1\u09BC/g, '\u09DC'], [/\u09A2\u09BC/g, '\u09DD'], [/\u09AF\u09BC/g, '\u09DF']];

const transliterate = (text) => {
      const joined = NUKTA.reduce((out, [pattern, letter]) => out.replace(pattern, letter), text);
      return [...joined].map((char) => (char in BENGALI ? BENGALI[char] : char)).join('');
};

const significantWords = (name) => {
      // An apostrophe sits inside a word, so it is removed rather than treated as a separator:
      // "Men's Footwear" is two words, not three, and gives MENSFOO rather than MENS.
      const words = transliterate(name)
            .replace(/['\u2019]/g, '')
            .toUpperCase()
            .split(/[^A-Z]+/)
            .filter(Boolean);
      const kept = words.filter((word) => !SKIP_WORDS.has(word.toLowerCase()));
      return kept.length ? kept : words;
};

/**
 * Every code this name could take, shortest and most readable first. A caller walks the list and
 * takes the first one no other category holds. The list always ends in codes that cannot clash,
 * so a caller that reaches the end has a usable answer rather than nothing.
 */
const buildCandidates = (name) => {
      const words = significantWords(name);
      if (!words.length) return [];

      const [first, second = ''] = words;
      const candidates = [];
      const add = (code) => {
            if (code.length >= 2 && code.length <= MAX_LENGTH && !candidates.includes(code)) candidates.push(code);
      };

      add(first.slice(0, 4) + second.slice(0, 3));

      // Taken, so lengthen: first the second word, then the first. Each step is still the name.
      for (let take = 4; take <= second.length; take++) add(first.slice(0, 4) + second.slice(0, take));
      for (let take = 5; take <= first.length; take++) add(first.slice(0, take) + second.slice(0, 3));

      // The name has no more letters to give. A trailing letter keeps it pronounceable and keeps
      // the promise that a code carries no digits.
      const base = (first.slice(0, 4) + second.slice(0, 3)).slice(0, MAX_LENGTH - 1);
      for (const suffix of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') add(base + suffix);

      return candidates;
};

module.exports = { buildCandidates, transliterate };
