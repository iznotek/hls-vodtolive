const HLSVod = require("../index.js");

describe("HLSVod type B transition cursor", () => {
  it("advances past a transition marker at index zero", () => {
    const vod = new HLSVod("http://example.com/master.m3u8");
    vod.SEQUENCE_DURATION = 6;
    const segments = [
      { discontinuity: true, vodTransition: true },
      ...Array.from({ length: 8 }, (_, index) => ({ duration: 2, uri: `segment-${index}.ts` })),
    ];
    let reads = 0;
    // Throw at the outer loop guard too, bounding the historical non-progress loop.
    vod.segments = {
      1000: new Proxy(segments, {
        get(target, key) {
          if (/^\d+$/.test(String(key)) && ++reads > 100) {
            throw new Error("segment cursor did not advance within its read budget");
          }
          return target[key];
        },
      }),
    };

    const sequences = vod.generateSequencesTypeBVideo("1000", ["1000"]);

    expect(sequences.length).toBeGreaterThan(0);
    expect(sequences[0]["1000"][0]).toEqual(segments[0]);
    expect(sequences[0]["1000"].find((segment) => segment.uri).uri).toBe("segment-0.ts");
    expect(sequences[sequences.length - 1]["1000"].slice(-1)[0].uri).toBe("segment-7.ts");
  });
});
