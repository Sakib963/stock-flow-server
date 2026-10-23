// Deterministic seeded pseudorandom number generator (Mulberry32).
// Avoid em dashes in any comments or strings.

function createPRNG(seed = 123456789) {
    let s = seed >>> 0;

    function next() {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    function int(min, max) {
        return Math.floor(next() * (max - min + 1)) + min;
    }

    function float(min, max) {
        return next() * (max - min) + min;
    }

    function pick(array) {
        if (!array || array.length === 0) return null;
        return array[int(0, array.length - 1)];
    }

    function pickWeighted(items, weights) {
        const total = weights.reduce((sum, w) => sum + w, 0);
        let r = next() * total;
        for (let i = 0; i < items.length; i++) {
            if (r < weights[i]) return items[i];
            r -= weights[i];
        }
        return items[items.length - 1];
    }

    function chance(probability) {
        return next() < probability;
    }

    function shuffle(array) {
        const result = [...array];
        for (let i = result.length - 1; i > 0; i--) {
            const j = int(0, i);
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }

    return {
        next,
        int,
        float,
        pick,
        pickWeighted,
        chance,
        shuffle,
    };
}

module.exports = { createPRNG };

