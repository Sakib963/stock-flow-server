// Crockford base 32: no I, L, O or U, so a code read aloud or typed from a label cannot be misread.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BITS = 40n;
const MASK = (1n << BITS) - 1n;

// The sequence number, scrambled so consecutive batches do not read as consecutive. Every step
// (an odd multiplier, a right xor-shift) is reversible within 40 bits, so two numbers never give
// the same code and no lookup is needed, even for two deliveries verified at the same moment.
const scramble = (n) => {
      let x = (n * 0x9e3779b97fn) & MASK;
      x ^= x >> 20n;
      x = (x * 0xbf58476d1dn) & MASK;
      x ^= x >> 20n;
      return x;
};

// B-XXXX-XXXX. Old codes are XXX-XXX-XXXXX, so the two shapes never match each other in a search.
const batch_code_of = (n) => {
      let x = scramble(BigInt(n));
      let chars = "";
      for (let i = 0; i < 8; i++) {
            chars = ALPHABET[Number(x & 31n)] + chars;
            x >>= 5n;
      }
      return `B-${chars.slice(0, 4)}-${chars.slice(4)}`;
};

const next_batch_code = async (tx) => {
      const [row] = await tx.get_data({ text: `SELECT nextval('inventory_batch_code_seq') AS n`, values: [] });
      return batch_code_of(row.n);
};

module.exports = { batch_code_of, next_batch_code };
