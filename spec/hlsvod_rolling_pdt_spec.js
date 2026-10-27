const HLSVod = require("../index.js");
const Readable = require("stream").Readable;

describe("HLSVod rolling programme date time", () => {
  const origin = Date.parse("2026-01-01T00:00:00.000Z");
  const bandwidths = ["1000", "2000"];
  const master = () => Readable.from([
    "#EXTM3U\n" + bandwidths.map((bw) => `#EXT-X-STREAM-INF:BANDWIDTH=${bw}\n${bw}/index.m3u8\n`).join(""),
  ]);
  const media = () => Readable.from([
    "#EXTM3U\n#EXT-X-TARGETDURATION:2\n" +
      Array.from({ length: 12 }, (_, index) => `#EXTINF:2,\nsegment-${index}.ts\n`).join("") +
      "#EXT-X-ENDLIST\n",
  ]);
  const createVod = (name, timeOffset) => {
    const vod = new HLSVod(`http://example.com/${name}/master.m3u8`, [], timeOffset, 0, "", {
      calculatePDT: true,
      sequenceAlwaysContainNewSegments: true,
    });
    vod.SEQUENCE_DURATION = 6;
    return vod;
  };
  const lastMediaSegment = (vod, bw) => vod.segments[bw].filter((segment) => segment.uri).slice(-1)[0];

  it("anchors a successor to the actual programme end after importing history with reload", async () => {
    const previous = createVod("previous", origin);
    await previous.load(master, media);
    const history = {};
    bandwidths.forEach((bw) => {
      history[bw] = [
        { discontinuity: true, vodTransition: true },
        ...Array.from({ length: 4 }, (_, index) => ({
          duration: 2,
          uri: `http://example.com/live/${bw}/history-${index}.ts`,
          timelinePosition: origin + (index - 4) * 2000,
        })),
      ];
    });
    await previous.reload(0, history, null, false);
    // Model persisted state too: the successor must not recount imported live history.
    const restored = createVod("restored");
    restored.fromJSON(previous.toJSON());
    bandwidths.forEach((bw) => restored.segments[bw].push({ discontinuity: true }));
    const tail = lastMediaSegment(restored, bandwidths[0]);
    const expected = tail.timelinePosition + tail.duration * 1000;
    expect(restored.timeOffset + restored.getNextVodDuration() * 1000).not.toBe(expected);

    const next = createVod("next");
    await next.loadAfter(restored, master, media);

    expect(next.timeOffset).toBe(expected);
    bandwidths.forEach((bw) => {
      expect(next.segments[bw].find((segment) => segment.uri && segment.uri.includes("/next/")).timelinePosition).toBe(expected);
    });
  });

  it("rejects disagreeing rendition programme ends", async () => {
    const previous = createVod("previous", origin);
    await previous.load(master, media);
    lastMediaSegment(previous, bandwidths[1]).timelinePosition += 1000;

    await expectAsync(createVod("next").loadAfter(previous, master, media)).toBeRejectedWithError(/rendition.*ends.*disagree/i);
  });

  it("uses the original duration fallback when the last media segment has no PDT", async () => {
    const previous = createVod("previous", origin);
    await previous.load(master, media);
    bandwidths.forEach((bw) => { lastMediaSegment(previous, bw).timelinePosition = null; });
    const next = createVod("next");

    await next.loadAfter(previous, master, media);

    expect(next.timeOffset).toBe(origin + 24000);
  });

  it("uses the original current-time fallback without any previous PDT", async () => {
    const previous = createVod("previous");
    await previous.load(master, media);
    spyOn(Date, "now").and.returnValue(origin);
    const next = createVod("next");

    await next.loadAfter(previous, master, media);

    expect(next.timeOffset).toBe(origin);
  });
});
